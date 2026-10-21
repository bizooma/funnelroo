import type { StripeSubscription } from "npm:stripe@17.7.0";
import type { Row, ServiceRoleClient, WorkspaceBillingRecord } from "./models.ts";
import { firstRecord, asArray } from "./auth.ts";
import { CATALOG_VERSION } from "./plans.ts";
import { parseLookupKey, ENVIRONMENT } from "./stripeCatalog.ts";

export interface SubscriptionMap {
  plan: "starter" | "growth" | null;
  interval: "monthly" | "annual" | null;
  status: string;
  stripe_status: string;
  stripe_subscription_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_item_id: string | null;
  paid_window_anchor: string | null;
  paid_through: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  catalog_version: string;
  last_sync_at: string;
  last_sync_status: string;
}

// Pure mapping: Stripe Subscription → WorkspaceBilling fields. No I/O, so it is
// exercised directly against fixtures and reused by every synchronization
// caller (checkout-return verification, webhook events, reconciliation).
export function mapSubscription(sub: StripeSubscription): SubscriptionMap {
  const item = sub.items?.data?.[0];
  const parsed = parseLookupKey(item?.price?.lookup_key);

  // current_period_* moved to the item level in newer Stripe API versions —
  // read from the subscription first, then fall back to the item.
  const startSec = sub.current_period_start ?? item?.current_period_start;
  const endSec = sub.current_period_end ?? item?.current_period_end;
  const periodStart = startSec ? new Date(startSec * 1000).toISOString() : null;
  const periodEnd = endSec ? new Date(endSec * 1000).toISOString() : null;

  const status = sub.status;
  let billingStatus: string;
  switch (status) {
    case "active":
    case "trialing":
      billingStatus = "paid";
      break;
    case "past_due":
    case "unpaid":
      billingStatus = "payment_grace";
      break;
    case "canceled":
      billingStatus = "canceled";
      break;
    case "incomplete":
    case "incomplete_expired":
    case "paused":
      billingStatus = "read_only";
      break;
    default:
      billingStatus = "read_only";
  }

  return {
    plan: parsed?.plan || null,
    interval: parsed?.interval || null,
    status: billingStatus,
    stripe_status: status,
    stripe_subscription_id: sub.id,
    stripe_customer_id:
      typeof sub.customer === "string" ? sub.customer : sub.customer?.id || null,
    stripe_subscription_item_id: item?.id || null,
    paid_window_anchor: periodStart,
    paid_through: periodEnd,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
    catalog_version: CATALOG_VERSION,
    last_sync_at: new Date().toISOString(),
    last_sync_status: "success",
  };
}

export interface SyncResult {
  synced: boolean;
  reason?: string;
  workspace_id?: string;
  subscription_id?: string;
  billing?: WorkspaceBillingRecord;
}

// The ONE idempotent synchronization routine. Every caller funnels through here.
// State is derived entirely from Stripe (the source of truth), so applying the
// same subscription twice converges to the same record, and a spurious call can
// at worst cause extra Stripe reads — never a fabricated grant.
export async function syncSubscription(
  sr: ServiceRoleClient,
  args: { subscription: StripeSubscription; workspaceId?: string | null }
): Promise<SyncResult> {
  const sub = args.subscription;
  if (!sub?.id) throw new Error("syncSubscription requires a subscription object");

  const fields = mapSubscription(sub);

  let wsId: string | null = args.workspaceId || sub.metadata?.workspace_id || null;
  let billing: WorkspaceBillingRecord | undefined;

  if (wsId) {
    billing = firstRecord<WorkspaceBillingRecord>(
      (await sr.entities.WorkspaceBilling.filter({
        workspace_id: wsId,
        environment: ENVIRONMENT,
      })) as WorkspaceBillingRecord[]
    );
  }
  if (!billing) {
    billing = firstRecord<WorkspaceBillingRecord>(
      (await sr.entities.WorkspaceBilling.filter({
        stripe_subscription_id: sub.id,
        environment: ENVIRONMENT,
      })) as WorkspaceBillingRecord[]
    );
    if (billing) wsId = billing.workspace_id;
  }
  if (!billing && fields.stripe_customer_id) {
    billing = firstRecord<WorkspaceBillingRecord>(
      (await sr.entities.WorkspaceBilling.filter({
        stripe_customer_id: fields.stripe_customer_id,
        environment: ENVIRONMENT,
      })) as WorkspaceBillingRecord[]
    );
    if (billing) wsId = billing.workspace_id;
  }
  if (!wsId) return { synced: false, reason: "workspace_unresolved", subscription_id: sub.id };

  // Out-of-order guard: a stale snapshot must not regress an already-advanced
  // paid_through while both are paid. Newer (further-out) snapshots always win.
  if (billing && fields.paid_through && billing.paid_through) {
    const incoming = new Date(fields.paid_through).getTime();
    const existing = new Date(billing.paid_through).getTime();
    if (incoming < existing && fields.status === "paid" && billing.status === "paid") {
      return { synced: false, reason: "stale_snapshot_ignored", workspace_id: wsId };
    }
  }

  let saved: WorkspaceBillingRecord;
  if (!billing) {
    saved = await sr.entities.WorkspaceBilling.create({
      workspace_id: wsId,
      environment: ENVIRONMENT,
      ...fields,
      legacy_access: false,
    });
  } else {
    saved = await sr.entities.WorkspaceBilling.update(billing.id, { ...fields });
  }
  return { synced: true, workspace_id: wsId, billing: saved };
}

export interface BillingEventRecord extends Row {
  id: string;
  stripe_event_id: string;
  type: string;
  state: string;
  attempts?: number | null;
  error?: string | null;
  workspace_id?: string | null;
  stripe_subscription_id?: string | null;
  environment?: string;
}

export interface RetryOutcome {
  event_id: string;
  recovered: boolean;
  error?: string;
}

// Retry any BillingEvent left in a failed state. Used by the reconciliation
// workflow so a failed webhook recovers unfinished work.
export async function retryFailedEvents(
  sr: ServiceRoleClient,
  handler: (ev: BillingEventRecord) => Promise<void>
): Promise<RetryOutcome[]> {
  const failed = asArray<BillingEventRecord>(
    (await sr.entities.BillingEvent.filter({
      environment: ENVIRONMENT,
      state: "failed",
    })) as BillingEventRecord[]
  );
  const results: RetryOutcome[] = [];
  for (const ev of failed.slice(0, 25)) {
    try {
      await handler(ev);
      await sr.entities.BillingEvent.update(ev.id, {
        state: "completed",
        processed_at: new Date().toISOString(),
      });
      results.push({ event_id: ev.stripe_event_id, recovered: true });
    } catch (e) {
      await sr.entities.BillingEvent.update(ev.id, {
        state: "failed",
        error: String((e as { message?: string })?.message || e),
        attempts: (ev.attempts || 0) + 1,
      });
      results.push({
        event_id: ev.stripe_event_id,
        recovered: false,
        error: String((e as { message?: string })?.message || e),
      });
    }
  }
  return results;
}