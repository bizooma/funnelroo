import type {
  Iso,
  ServiceRoleClient,
  UsageOperationRecord,
  UsageWindowRecord,
  WorkspaceBillingRecord,
} from "./models.ts";
import { firstRecord, asArray } from "./auth.ts";
import { usageWindowFor, type PeriodWindow } from "./billing.ts";
import {
  enforcementEnabled,
  canPerformGatedAction,
  windowedAllowance,
  capacityAllowance,
} from "./entitlements.ts";
import { ENVIRONMENT } from "./stripeCatalog.ts";

// Durable, retry-safe usage reservation service.
//
// Pattern: reserve → consume/release. A reservation is keyed by a caller-
// supplied operation_key, so a retried request does NOT double-count. The
// operation also stores a payload fingerprint: the same key with a DIFFERENT
// payload is a conflict, not a retry.
//
// Windowing: ONE UsageWindow row per (workspace, metric, period). The period is
// part of the row identity, so rollover is implicit — a new period is a new row
// and the previous row is never erased or reset. resolveWindow() merges any
// duplicate rows left by a concurrent first use into the oldest survivor.
//
// Capacity (email/AI/image) is checked AFTER an atomic increment of `reserved`
// (reserve-then-validate): the increment is atomic and over-admissions release
// immediately. Enforcement applies only to designated test workspaces.
//
// Atomicity: the only cross-record primitives used are conditional bulk updates
// (`$inc` on the window, and state-guarded `updateMany` claims). These are
// per-statement atomic and conditional, which is what prevents double-consumption
// and counter splitting. There is no multi-record transaction, so under heavy
// simultaneous contention a boundary request can be conservatively rejected —
// the service never over-admits.

export type MeteringMetric = "email_send" | "ai_text" | "image";
export type CapacityMetric = "live_funnels" | "team_users" | "contacts";

export const WINDOW_METRICS: Record<MeteringMetric, { windowKey: string }> = {
  email_send: { windowKey: "email_sends" },
  ai_text: { windowKey: "ai_text_actions" },
  image: { windowKey: "images" },
};

export type ReserveReason =
  | "unknown_metric"
  | "missing_operation_key"
  | "access_blocked"
  | "no_usage_window"
  | "limit_reached"
  | "operation_conflict";

export interface ReserveResult {
  allowed: boolean;
  reason?: ReserveReason;
  duplicate?: boolean;
  enforcement?: boolean;
  unenforced?: boolean;
  operation_id?: string;
  window_id?: string;
  state?: string;
  allowance?: number | null;
  used?: number;
  remaining?: number;
  access_state?: string;
}

export interface CapacityResult {
  allowed: boolean;
  used: number;
  allowance: number | null;
  enforcement: boolean;
}

export interface SettleResult {
  ok: boolean;
  reason?: string;
  duplicate?: boolean;
  operation_id?: string;
}

async function loadBilling(
  sr: ServiceRoleClient,
  workspaceId: string
): Promise<WorkspaceBillingRecord | undefined> {
  const result = await sr.entities.WorkspaceBilling.filter({
    workspace_id: workspaceId,
    environment: ENVIRONMENT,
  });
  return firstRecord<WorkspaceBillingRecord>(result);
}

async function loadOperation(
  sr: ServiceRoleClient,
  args: { workspaceId?: string; operationId?: string; operationKey?: string }
): Promise<UsageOperationRecord | undefined> {
  if (args.operationId) {
    return await sr.entities.UsageOperation.get(args.operationId).catch(() => undefined);
  }
  return firstRecord<UsageOperationRecord>(
    (await sr.entities.UsageOperation.filter({
      workspace_id: args.workspaceId,
      operation_key: args.operationKey,
    })) as UsageOperationRecord[]
  );
}

// Resolve the window for (workspace, windowKey, period). Creates it if absent
// and merges duplicates if a concurrent first use created more than one.
async function resolveWindow(
  sr: ServiceRoleClient,
  workspaceId: string,
  windowKey: string,
  window: PeriodWindow,
  allowance: number | null
): Promise<UsageWindowRecord> {
  const rows = asArray<UsageWindowRecord>(
    (await sr.entities.UsageWindow.filter(
      { workspace_id: workspaceId, metric: windowKey, window_start: window.start },
      { sort: "created_date" }
    )) as UsageWindowRecord[]
  );

  if (!rows.length) {
    return await sr.entities.UsageWindow.create({
      workspace_id: workspaceId,
      metric: windowKey,
      window_start: window.start,
      window_end: window.end,
      allowance,
      used: 0,
      reserved: 0,
    });
  }

  const survivor = rows[0];
  if (rows.length > 1) {
    // Concurrent first use created duplicate rows. Merge their counters into the
    // oldest survivor and delete the rest so the counters can never be split.
    let used = survivor.used || 0;
    let reserved = survivor.reserved || 0;
    for (let i = 1; i < rows.length; i++) {
      used += rows[i].used || 0;
      reserved += rows[i].reserved || 0;
      try {
        await sr.entities.UsageWindow.delete(rows[i].id);
      } catch {
        // Already removed by another resolver.
      }
    }
    return await sr.entities.UsageWindow.update(survivor.id, { used, reserved, allowance });
  }

  if (survivor.allowance !== allowance) {
    return await sr.entities.UsageWindow.update(survivor.id, { allowance });
  }
  return survivor;
}

// Create the windows for a billing state so a first concurrent burst cannot race
// window creation. Safe to call repeatedly.
export async function provisionWindows(
  sr: ServiceRoleClient,
  billing: WorkspaceBillingRecord | null | undefined,
  workspaceId: string
): Promise<string[]> {
  if (!billing) return [];
  const created: string[] = [];
  for (const metric of Object.keys(WINDOW_METRICS) as MeteringMetric[]) {
    const cfg = WINDOW_METRICS[metric];
    const window = usageWindowFor(billing, cfg.windowKey);
    if (!window) continue;
    const existing = firstRecord<UsageWindowRecord>(
      (await sr.entities.UsageWindow.filter({
        workspace_id: workspaceId,
        metric: cfg.windowKey,
        window_start: window.start,
      })) as UsageWindowRecord[]
    );
    const allowance = windowedAllowance(billing, cfg.windowKey);
    if (!existing) {
      await resolveWindow(sr, workspaceId, cfg.windowKey, window, allowance);
      created.push(cfg.windowKey);
    }
  }
  return created;
}

// Reserve one or more units of a windowed metric.
export async function reserveUsage(
  sr: ServiceRoleClient,
  args: {
    workspaceId: string;
    metric: MeteringMetric;
    operationKey: string;
    units?: number;
    sourceRef?: string;
    payloadFingerprint?: string;
  }
): Promise<ReserveResult> {
  const cfg = WINDOW_METRICS[args.metric];
  if (!cfg) return { allowed: false, reason: "unknown_metric" };
  if (!args.operationKey) return { allowed: false, reason: "missing_operation_key" };
  const units = args.units || 1;

  const billing = await loadBilling(sr, args.workspaceId);
  if (!enforcementEnabled(billing)) return { allowed: true, enforcement: false };

  const gate = canPerformGatedAction(billing);
  if (!gate.allowed) {
    return { allowed: false, reason: "access_blocked", access_state: gate.access_state };
  }

  const window = usageWindowFor(billing, cfg.windowKey);
  if (!window) return { allowed: false, reason: "no_usage_window" };

  const prior = firstRecord<UsageOperationRecord>(
    (await sr.entities.UsageOperation.filter({
      workspace_id: args.workspaceId,
      operation_key: args.operationKey,
    })) as UsageOperationRecord[]
  );
  // The same logical operation with a different payload is a conflict, whatever
  // state that operation is currently in.
  if (
    prior &&
    prior.payload_fingerprint &&
    args.payloadFingerprint &&
    prior.payload_fingerprint !== args.payloadFingerprint
  ) {
    return { allowed: false, reason: "operation_conflict", operation_id: prior.id };
  }
  if (prior && (prior.state === "reserved" || prior.state === "consumed")) {
    // A retried operation recovers its ORIGINAL reservation. Even after a period
    // rollover it stays tied to the window it was created in and never spends the
    // new period's allowance.
    return {
      allowed: true,
      duplicate: true,
      operation_id: prior.id,
      window_id: prior.window_id || undefined,
      state: prior.state,
    };
  }
  // prior in "released"/"failed": the earlier attempt gave its unit back, so this
  // retry re-reserves the SAME identity row rather than adding a duplicate key.

  const allowance = windowedAllowance(billing, cfg.windowKey);
  if (allowance == null) return { allowed: true, unenforced: true };

  const w = await resolveWindow(sr, args.workspaceId, cfg.windowKey, window, allowance);

  // Atomic conditional increment — the concurrency primitive. Capacity is
  // validated after it and an over-admission releases immediately.
  await sr.entities.UsageWindow.updateMany({ id: w.id }, { $inc: { reserved: units } });
  const after = await sr.entities.UsageWindow.get(w.id);
  const committed = (after.used || 0) + (after.reserved || 0);
  if (committed > allowance) {
    await sr.entities.UsageWindow.updateMany({ id: w.id }, { $inc: { reserved: -units } });
    return {
      allowed: false,
      reason: "limit_reached",
      used: after.used || 0,
      allowance,
      remaining: Math.max(0, allowance - (after.used || 0)),
    };
  }

  if (prior) {
    const reused = await sr.entities.UsageOperation.update(prior.id, {
      metric: args.metric,
      units,
      state: "reserved",
      window_id: w.id,
      source_ref: args.sourceRef || "",
      payload_fingerprint: args.payloadFingerprint || "",
    });
    return { allowed: true, operation_id: reused.id, window_id: w.id, allowance };
  }

  const op = await sr.entities.UsageOperation.create({
    workspace_id: args.workspaceId,
    operation_key: args.operationKey,
    metric: args.metric,
    units,
    state: "reserved",
    window_id: w.id,
    source_ref: args.sourceRef || "",
    payload_fingerprint: args.payloadFingerprint || "",
  });
  return { allowed: true, operation_id: op.id, window_id: w.id, allowance };
}

// Promote a reservation to a consumed unit. Idempotent: only the first consumer
// wins the reserved → consumed transition, so a concurrent double-consume cannot
// count twice.
export async function consumeUsage(
  sr: ServiceRoleClient,
  args: { workspaceId?: string; operationId?: string; operationKey?: string }
): Promise<SettleResult> {
  const op = await loadOperation(sr, args);
  if (!op) return { ok: false, reason: "operation_not_found" };
  if (op.state === "consumed") return { ok: true, duplicate: true, operation_id: op.id };
  if (op.state === "released" || op.state === "failed") {
    return { ok: false, reason: "not_reserved" };
  }
  const units = op.units || 1;
  const claim = await sr.entities.UsageOperation.updateMany(
    { id: op.id, state: "reserved" },
    { $set: { state: "consumed" } }
  );
  if (claim.updated) {
    await sr.entities.UsageWindow.updateMany(
      { id: op.window_id },
      { $inc: { reserved: -units, used: units } }
    );
  }
  return { ok: true, operation_id: op.id };
}

// Release a reservation without consuming (failure path). Idempotent.
export async function releaseUsage(
  sr: ServiceRoleClient,
  args: { workspaceId?: string; operationId?: string; operationKey?: string }
): Promise<SettleResult> {
  const op = await loadOperation(sr, args);
  if (!op) return { ok: false, reason: "operation_not_found" };
  if (op.state === "released" || op.state === "consumed") {
    return { ok: true, duplicate: true, operation_id: op.id };
  }
  const units = op.units || 1;
  const claim = await sr.entities.UsageOperation.updateMany(
    { id: op.id, state: "reserved" },
    { $set: { state: "released" } }
  );
  if (claim.updated) {
    await sr.entities.UsageWindow.updateMany({ id: op.window_id }, { $inc: { reserved: -units } });
  }
  return { ok: true, operation_id: op.id };
}

// Capacity gauge check (not windowed): live funnels, team users, contacts.
export async function checkCapacity(
  sr: ServiceRoleClient,
  args: { workspaceId: string; used: number; metricKey: CapacityMetric }
): Promise<CapacityResult> {
  const billing = await loadBilling(sr, args.workspaceId);
  const allowance = capacityAllowance(billing, args.metricKey);
  if (!enforcementEnabled(billing) || allowance == null) {
    return { allowed: true, used: args.used, allowance, enforcement: false };
  }
  return { allowed: args.used < allowance, used: args.used, allowance, enforcement: true };
}

export async function countCapacity(
  sr: ServiceRoleClient,
  workspaceId: string,
  metricKey: CapacityMetric
): Promise<number> {
  if (metricKey === "live_funnels") {
    return sr.entities.Funnel.count({ workspace_id: workspaceId, state: "published" });
  }
  if (metricKey === "team_users") {
    const active = await sr.entities.Membership.count({ workspace_id: workspaceId, status: "active" });
    const pending = asArray(
      (await sr.entities.Invite.filter({ workspace_id: workspaceId, status: "pending" })) as {
        expires_at?: Iso | null;
      }[]
    ).filter((iv) => !iv.expires_at || new Date(iv.expires_at).getTime() > Date.now()).length;
    return active + pending;
  }
  if (metricKey === "contacts") {
    return sr.entities.Contact.count({ workspace_id: workspaceId });
  }
  return 0;
}