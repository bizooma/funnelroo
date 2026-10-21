import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { requireMembership, firstRecord, ok, err, HttpError } from "../../shared/auth.ts";
import {
  getStripeClient,
  isStripeConfigured,
  StripeConfigError,
} from "../../shared/stripeClient.ts";
import { syncSubscription } from "../../shared/subscriptionSync.ts";
import { ENVIRONMENT } from "../../shared/stripeCatalog.ts";

// Authenticated checkout-return verification. A success-page visit is NOT proof
// of payment: this retrieves the Checkout Session from Stripe, confirms the
// payment/subscription state against Stripe, and syncs. The webhook is the
// parallel authoritative path — both funnel through the same idempotent sync.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const sessionId = body.session_id;
    if (!sessionId) return err(400, "Missing session_id");

    if (!isStripeConfigured()) {
      return err(503, "Stripe is not configured yet. Verification is unavailable.");
    }

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });

    const wsId = session.metadata?.workspace_id || session.client_reference_id;
    if (!wsId) return err(400, "This checkout session is not associated with a workspace.");

    // Authorization: the caller must be an active member of the session's workspace.
    await requireMembership(base44, wsId, ["owner", "admin", "member"]);

    let sub = session.subscription;
    if (!sub && session.subscription_id) {
      sub = await stripe.subscriptions.retrieve(session.subscription_id);
    }
    if (!sub || typeof sub === "string") {
      return ok({ verified: false, reason: "no_subscription_yet", session_status: session.status, payment_status: session.payment_status });
    }

    const paid = session.payment_status === "paid" || sub.status === "active";
    if (!paid) {
      return ok({
        verified: false,
        reason: "not_paid_yet",
        payment_status: session.payment_status,
        subscription_status: sub.status,
      });
    }

    const result = await syncSubscription(sr, { subscription: sub, workspaceId: wsId });

    const op = firstRecord(
      await sr.entities.BillingOperation.filter({
        stripe_checkout_session_id: sessionId,
        environment: ENVIRONMENT,
      })
    );
    if (op && op.state !== "completed") {
      await sr.entities.BillingOperation.update(op.id, { state: "completed" });
    }

    return ok({
      verified: true,
      workspace_id: wsId,
      subscription_status: sub.status,
      plan: result?.billing?.plan || null,
    });
  } catch (e) {
    if (e instanceof StripeConfigError) return err(503, e.message);
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}