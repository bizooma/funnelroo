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

// Owner-only hosted Checkout. Creates (or reuses) one Stripe Customer per
// workspace per environment, prevents concurrent checkout attempts from
// creating duplicate purchases, and returns the hosted Checkout URL.
//
// Fail-closed: with no valid test key this returns an honest 503 config error,
// never a fabricated URL. Live keys are rejected.

const OPERATION_TTL_MS = 30 * 60 * 1000;
const ALLOWED_ORIGINS = [
  "https://funnel-roo-flow.base44.app",
  "https://funnelroo.com",
  "https://www.funnelroo.com",
];

function resolveOrigin(requested) {
  if (requested && ALLOWED_ORIGINS.includes(requested)) return requested;
  return ALLOWED_ORIGINS[0];
}

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
    const origin = resolveOrigin(body.origin);

    // --- Prevent concurrent checkouts: reuse an open session if one exists ---
    const openOps = asArray(
      await sr.entities.BillingOperation.filter({
        workspace_id: body.workspace_id,
        environment: ENVIRONMENT,
        operation_type: "checkout",
        state: "pending",
      })
    );
    for (const op of openOps) {
      if (!op.stripe_checkout_session_id) continue;
      const fresh = op.expires_at && new Date(op.expires_at).getTime() > Date.now();
      if (!fresh) {
        await sr.entities.BillingOperation.update(op.id, { state: "expired" });
        continue;
      }
      const sess = await stripe.checkout.sessions
        .retrieve(op.stripe_checkout_session_id)
        .catch(() => null);
      if (sess && sess.status === "open" && sess.url) {
        return ok({ url: sess.url, reused: true, operation_id: op.id });
      }
      await sr.entities.BillingOperation.update(op.id, {
        state: sess?.status === "complete" ? "completed" : "expired",
      });
    }

    // --- Resolve the Stripe Price for this plan/interval (by lookup_key) ---
    const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    const price = prices.data?.[0];
    const check = validatePrice(price, plan, interval);
    if (!check.valid) {
      return err(409, `Stripe price ${lookupKey} does not match the catalog (${check.reason}).`);
    }

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
      success_url: `${origin}/billing/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/settings?tab=billing`,
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
      expires_at: new Date(Date.now() + OPERATION_TTL_MS).toISOString(),
    });

    return ok({ url: session.url, operation_id: op.id, session_id: session.id });
  } catch (e) {
    if (e instanceof StripeConfigError) return err(503, e.message);
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}