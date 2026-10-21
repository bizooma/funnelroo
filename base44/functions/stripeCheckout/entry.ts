import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import {
  requireMembership,
  firstRecord,
  asArray,
  ok,
  err,
  HttpError,
} from "../../shared/auth.ts";
import {
  getStripeClient,
  assertTestMode,
  isStripeConfigured,
  StripeConfigError,
} from "../../shared/stripeClient.ts";
import { keyFor, validatePrice, ENVIRONMENT } from "../../shared/stripeCatalog.ts";
import { syncSubscription } from "../../shared/subscriptionSync.ts";
import {
  billingReturnUrl,
  billingSettingsUrl,
  customerOrigin,
} from "../../shared/appOrigins.ts";

// Owner-only hosted Checkout. Creates (or reuses) one Stripe Customer per
// workspace per environment, prevents concurrent checkout attempts from
// creating duplicate purchases, and returns the hosted Checkout URL.
//
// Customer-facing return URLs come from the configured canonical origin
// (PUBLIC_APP_ORIGIN) via the shared builder — never from a browser-supplied
// value alone, and never from a backend function host. An open session is
// reused ONLY when it still matches this workspace, environment, plan, interval,
// customer, and both canonical destinations; an incompatible open session is
// expired rather than paid against the wrong outcome.
//
// Fail-closed: with no valid test key this returns an honest 503 config error,
// never a fabricated URL. Live keys are rejected.

const ACTIVE_SUB_STATUSES = ["active", "trialing", "past_due"];

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const { user } = await requireMembership(base44, body.workspace_id, ["owner"]);

    const plan = body.plan === "growth" ? "growth" : body.plan === "starter" ? "starter" : null;
    const interval =
      body.interval === "annual" ? "annual" : body.interval === "monthly" ? "monthly" : null;
    if (!plan || !interval) return err(400, "Choose a valid plan and billing interval.");

    if (!isStripeConfigured()) {
      return err(503, "Stripe is not configured yet. Checkout is unavailable until test-mode keys are set.");
    }
    assertTestMode();

    const stripe = getStripeClient();
    const lookupKey = keyFor(plan, interval);

    // Canonical destinations for this purchase (server-controlled origin).
    const origin = customerOrigin(body.origin);
    const successUrl = billingReturnUrl(origin);
    const cancelUrl = billingSettingsUrl(origin);

    // --- One Stripe Customer per workspace per environment ---
    let billing = firstRecord(
      await sr.entities.WorkspaceBilling.filter({
        workspace_id: body.workspace_id,
        environment: ENVIRONMENT,
      })
    );
    let customerId = billing?.stripe_customer_id || null;
    if (customerId) {
      const existing = await stripe.customers.retrieve(customerId).catch(() => null);
      if (!existing || existing.deleted) customerId = null;
    }
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email || undefined,
        metadata: { workspace_id: body.workspace_id, environment: ENVIRONMENT, app: "funnelroo" },
      });
      customerId = customer.id;
      if (billing) {
        billing = await sr.entities.WorkspaceBilling.update(billing.id, {
          stripe_customer_id: customerId,
        });
      } else {
        billing = await sr.entities.WorkspaceBilling.create({
          workspace_id: body.workspace_id,
          environment: ENVIRONMENT,
          status: "read_only",
          stripe_customer_id: customerId,
          legacy_access: false,
          enforcement_enabled: false,
        });
      }
    }

    // --- Reconcile existing checkout operations before offering another one ---
    const openOps = asArray(
      await sr.entities.BillingOperation.filter({
        workspace_id: body.workspace_id,
        environment: ENVIRONMENT,
        operation_type: "checkout",
        state: "pending",
      })
    );
    for (const op of openOps) {
      if (!op.stripe_checkout_session_id) {
        await sr.entities.BillingOperation.update(op.id, { state: "expired" });
        continue;
      }
      const sess = await stripe.checkout.sessions
        .retrieve(op.stripe_checkout_session_id)
        .catch(() => null);
      if (!sess) {
        await sr.entities.BillingOperation.update(op.id, { state: "expired" });
        continue;
      }
      if (sess.status === "complete") {
        // Already paid. Reconcile that purchase instead of creating a second
        // subscription to recover it.
        await sr.entities.BillingOperation.update(op.id, { state: "completed" });
        const subId =
          typeof sess.subscription === "string" ? sess.subscription : sess.subscription?.id;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId).catch(() => null);
          if (sub) {
            await syncSubscription(sr, { subscription: sub, workspaceId: body.workspace_id }).catch(
              () => {}
            );
          }
        }
        return ok({
          url: null,
          already_active: true,
          reason: "purchase_completed",
          plan: op.plan || plan,
          interval: op.interval || interval,
        });
      }
      if (sess.status === "open" && sess.url) {
        const compatible =
          sess.metadata?.workspace_id === body.workspace_id &&
          sess.metadata?.environment === ENVIRONMENT &&
          sess.metadata?.plan === plan &&
          sess.metadata?.interval === interval &&
          sess.customer === customerId &&
          sess.success_url === successUrl &&
          sess.cancel_url === cancelUrl;
        if (compatible) {
          return ok({ url: sess.url, reused: true, operation_id: op.id });
        }
        // Stale plan, interval, customer, or destination (e.g. an old link built
        // for the backend host): expire the open session so it can never be paid
        // against the wrong outcome, then continue to a fresh session.
        await stripe.checkout.sessions.expire(sess.id).catch(() => {});
        await sr.entities.BillingOperation.update(op.id, { state: "expired" });
        continue;
      }
      await sr.entities.BillingOperation.update(op.id, { state: "expired" });
    }

    // --- Never open a second subscription for a workspace that already has one ---
    if (billing?.stripe_subscription_id) {
      const active = await stripe.subscriptions
        .retrieve(billing.stripe_subscription_id)
        .catch(() => null);
      if (active && ACTIVE_SUB_STATUSES.includes(active.status)) {
        return ok({
          url: null,
          already_active: true,
          reason: "active_subscription",
          plan: billing.plan || null,
          interval: billing.interval || null,
        });
      }
    }

    // --- Resolve the Stripe Price for this plan/interval (by lookup_key) ---
    const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    const price = prices.data?.[0];
    const check = validatePrice(price, plan, interval);
    if (!check.valid) {
      return err(409, `Stripe price ${lookupKey} does not match the catalog (${check.reason}).`);
    }

    // --- Create the hosted Checkout Session ---
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: price.id, quantity: 1 }],
      allow_promotion_codes: false,
      client_reference_id: body.workspace_id,
      metadata: { workspace_id: body.workspace_id, environment: ENVIRONMENT, plan, interval },
      subscription_data: {
        metadata: { workspace_id: body.workspace_id, environment: ENVIRONMENT, plan, interval },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    const op = await sr.entities.BillingOperation.create({
      workspace_id: body.workspace_id,
      environment: ENVIRONMENT,
      operation_type: "checkout",
      intent_key: `${body.workspace_id}:${plan}:${interval}:${ENVIRONMENT}`,
      stripe_checkout_session_id: session.id,
      plan,
      interval,
      state: "pending",
      created_by: user.id,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });

    return ok({ url: session.url, operation_id: op.id, session_id: session.id });
  } catch (e) {
    if (e instanceof StripeConfigError) return err(503, e.message);
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}