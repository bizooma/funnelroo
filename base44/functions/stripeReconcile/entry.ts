import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { firstRecord, asArray, isPlatformOperator, ok, err } from "../../shared/auth.ts";
import {
  getStripeClient,
  isStripeConfigured,
  StripeConfigError,
} from "../../shared/stripeClient.ts";
import { syncSubscription, retryFailedEvents } from "../../shared/subscriptionSync.ts";
import { ENVIRONMENT } from "../../shared/stripeCatalog.ts";

// Scheduled reconciliation, invoked by the BillingReconcile workflow.
//
// Authorization: the caller must be an authenticated platform operator AND the
// invocation must originate from the workflow (body._workflow). A caller-
// supplied flag ALONE is not sufficient — an anonymous or ordinary app-user
// caller with _system:true is still rejected. Because sync derives all state
// from Stripe (the source of truth), an unauthorized call could at worst cause
// extra Stripe reads, never a fabricated grant.
//
// Work performed:
//  1. Retry failed BillingEvents (recover unfinished work).
//  2. Re-fetch and re-sync every subscription-bearing workspace so missed
//     webhooks, expiries, and renewals converge.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));

    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      user = null;
    }
    const isSystem = isPlatformOperator(user) && body._workflow === true;
    if (!isSystem) {
      return err(403, "Reconciliation must be triggered by the scheduled workflow from a platform operator.");
    }

    if (!isStripeConfigured()) {
      return ok({ skipped: "stripe_not_configured" });
    }
    const stripe = getStripeClient();

    // 1. Recover failed events.
    const recovered = await retryFailedEvents(sr, async (ev) => {
      // Re-fetch the object by id from the stored event is not persisted, so
      // recovery re-drives subscription sync for the affected workspace.
      const wsId = ev.workspace_id;
      if (!wsId) return;
      const subId = ev.stripe_subscription_id;
      if (!subId) return;
      const sub = await stripe.subscriptions.retrieve(subId);
      await syncSubscription(sr, { subscription: sub, workspaceId: wsId });
    });

    // 2. Re-sync all subscription-bearing workspaces.
    const records = asArray(
      await sr.entities.WorkspaceBilling.filter({
        environment: ENVIRONMENT,
        stripe_subscription_id: { $exists: true },
      })
    );

    const results = [];
    for (const rec of records) {
      try {
        const sub = await stripe.subscriptions.retrieve(rec.stripe_subscription_id);
        const r = await syncSubscription(sr, { subscription: sub, workspaceId: rec.workspace_id });
        results.push({ workspace_id: rec.workspace_id, synced: r.synced, status: sub.status });
      } catch (e) {
        await sr.entities.WorkspaceBilling.update(rec.id, {
          last_sync_at: new Date().toISOString(),
          last_sync_status: "failed",
        }).catch(() => {});
        results.push({ workspace_id: rec.workspace_id, error: String(e?.message || e) });
      }
    }

    return ok({ reconciled: results.length, recovered, results });
  } catch (e) {
    if (e instanceof StripeConfigError) return err(503, e.message);
    return err(500, e.message);
  }
}