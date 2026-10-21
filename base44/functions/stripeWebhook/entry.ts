import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { firstRecord, ok, err } from "../../shared/auth.ts";
import {
  getStripeClient,
  isStripeConfigured,
  isWebhookSigningConfigured,
  webhookSecret,
  StripeConfigError,
} from "../../shared/stripeClient.ts";
import { syncSubscription } from "../../shared/subscriptionSync.ts";
import { ENVIRONMENT } from "../../shared/stripeCatalog.ts";

// Public Stripe webhook endpoint — the authoritative access path. It works even
// when the customer pays and never returns to the app.
//
// Deploy target (register in the Stripe TEST dashboard):
//   https://funnel-roo-flow.base44.app/functions/stripeWebhook
// Supported events:
//   checkout.session.completed, customer.subscription.created,
//   customer.subscription.updated, customer.subscription.deleted,
//   invoice.paid, invoice.payment_failed
//
// Fail-closed: without STRIPE_WEBHOOK_SECRET this returns 503 and processes
// nothing. Every event is signature-verified and durably recorded for
// idempotent replay. A replayed completed event is a no-op; a failed event is
// retried by the reconciliation workflow.

const MAX_PAYLOAD_BYTES = 512 * 1024;
const HANDLED = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
];

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;

    const rawBody = await req.text();
    if (rawBody.length > MAX_PAYLOAD_BYTES) return err(413, "Payload too large");

    if (!isStripeConfigured()) {
      return err(503, "Stripe is not configured yet. Webhook processing is disabled.");
    }
    if (!isWebhookSigningConfigured()) {
      return err(503, "Webhook signing secret not configured. Processing disabled.");
    }

    const signature = req.headers.get("stripe-signature") || "";
    const stripe = getStripeClient();
    let event;
    try {
      event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret());
    } catch (e) {
      return err(400, `Invalid webhook signature`);
    }

    // --- Idempotency: durable event record keyed by Stripe event id ---
    let record = firstRecord(
      await sr.entities.BillingEvent.filter({ stripe_event_id: event.id, environment: ENVIRONMENT })
    );
    if (record && record.state === "completed") {
      return ok({ skipped: "duplicate", event_id: event.id });
    }
    if (!record) {
      record = await sr.entities.BillingEvent.create({
        stripe_event_id: event.id,
        environment: ENVIRONMENT,
        type: event.type,
        state: "processing",
        attempts: 1,
      });
    } else {
      await sr.entities.BillingEvent.update(record.id, {
        state: "processing",
        attempts: (record.attempts || 0) + 1,
      });
    }

    if (!HANDLED.includes(event.type)) {
      await sr.entities.BillingEvent.update(record.id, {
        state: "completed",
        processed_at: new Date().toISOString(),
      });
      return ok({ skipped: "unsupported_event_type", event_type: event.type });
    }

    try {
      await processEvent(sr, stripe, event);
      await sr.entities.BillingEvent.update(record.id, {
        state: "completed",
        processed_at: new Date().toISOString(),
      });
      return ok({ processed: true, event_type: event.type });
    } catch (e) {
      await sr.entities.BillingEvent.update(record.id, {
        state: "failed",
        error: String(e?.message || e),
      });
      // Acknowledge so Stripe does not retry indefinitely; reconciliation
      // recovers unfinished work from the persisted failed record.
      return ok({ processed: false, error: String(e?.message || e) });
    }
  } catch (e) {
    if (e instanceof StripeConfigError) return err(503, e.message);
    return err(500, e.message);
  }
}

async function processEvent(sr, stripe, event) {
  const obj = event.data.object;

  if (event.type === "checkout.session.completed") {
    const wsId = obj.metadata?.workspace_id || obj.client_reference_id;
    const subId = typeof obj.subscription === "string" ? obj.subscription : obj.subscription?.id;
    if (!subId) return;
    const sub = await stripe.subscriptions.retrieve(subId);
    await syncSubscription(sr, { subscription: sub, workspaceId: wsId });
    await markOperationCompleted(sr, obj.id);
    return;
  }

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    await syncSubscription(sr, { subscription: obj, workspaceId: obj.metadata?.workspace_id || null });
    return;
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const subId =
      typeof obj.subscription === "string"
        ? obj.subscription
        : obj.subscription?.id || obj.parent?.subscription_details?.subscription;
    if (!subId) return;
    const sub = await stripe.subscriptions.retrieve(subId);
    await syncSubscription(sr, { subscription: sub, workspaceId: sub.metadata?.workspace_id || null });
    return;
  }
}

async function markOperationCompleted(sr, sessionId) {
  const op = firstRecord(
    await sr.entities.BillingOperation.filter({
      stripe_checkout_session_id: sessionId,
      environment: ENVIRONMENT,
    })
  );
  if (op && op.state !== "completed") {
    await sr.entities.BillingOperation.update(op.id, { state: "completed" });
  }
}