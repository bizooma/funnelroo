import type {
  Iso,
  ServiceRoleClient,
  UsageOperationRecord,
  UsageWindowRecord,
  WorkspaceBillingRecord,
} from "./models.ts";
import { firstRecord, asArray, HttpError } from "./auth.ts";
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
  | "operation_conflict"
  | "unavailable";

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
  allowance: number | null,
  depth = 0
): Promise<UsageWindowRecord> {
  // Each recursion removes at least one competing row, so this cannot spin.
  // Failing closed is far safer than reserving against a window we could not
  // reconcile.
  if (depth > 3) {
    throw new HttpError(503, "Usage window could not be reconciled safely");
  }
  const rows = asArray<UsageWindowRecord>(
    (await sr.entities.UsageWindow.filter(
      { workspace_id: workspaceId, metric: windowKey, window_start: window.start },
      { sort: "created_date" }
    )) as UsageWindowRecord[]
  );

  if (!rows.length) {
    await sr.entities.UsageWindow.create({
      workspace_id: workspaceId,
      metric: windowKey,
      window_start: window.start,
      window_end: window.end,
      allowance,
      used: 0,
      reserved: 0,
    });
    // Re-read so every concurrent first-use caller converges on the SAME row.
    // Returning the row we just created would let N racing callers each reserve
    // against their OWN row, splitting the counters across N records and
    // admitting N x the allowance against a single allowance.
    return await resolveWindow(sr, workspaceId, windowKey, window, allowance, depth + 1);
  }

  const survivor = rows[0];
  if (rows.length > 1) {
    // Concurrent first use created duplicate rows. Fold each duplicate's counters
    // into the oldest survivor with an ATOMIC increment — never a blind $set of
    // summed values, which could drop a reservation made in the meantime — then
    // delete the duplicate so the counters can never be split across records.
    for (let i = 1; i < rows.length; i++) {
      const dup = rows[i];
      const dupUsed = dup.used || 0;
      const dupReserved = dup.reserved || 0;
      if (dupUsed || dupReserved) {
        try {
          await sr.entities.UsageWindow.updateMany(
            { id: survivor.id },
            { $inc: { used: dupUsed, reserved: dupReserved } }
          );
        } catch {
          // Survivor vanished; the duplicate is still removed below.
        }
      }
      try {
        await sr.entities.UsageWindow.delete(dup.id);
      } catch {
        // Already removed by another resolver.
      }
    }
    const merged = firstRecord<UsageWindowRecord>(
      (await sr.entities.UsageWindow.filter({ id: survivor.id })) as UsageWindowRecord[]
    );
    if (merged) {
      if (merged.allowance !== allowance) {
        return await sr.entities.UsageWindow.update(merged.id, { allowance });
      }
      return merged;
    }
    return await resolveWindow(sr, workspaceId, windowKey, window, allowance, depth + 1);
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

  // --- Identity resolution ------------------------------------------------
  // Exactly one operation row must exist per operation key. A read straight after
  // a write can miss the row just created, and a concurrent first attempt can
  // create its own, so we create when absent, re-read, and consolidate down to
  // the OLDEST row. Duplicates never own a charge, so removing them is lossless —
  // and no counter is touched until after this convergence.
  let identity = await loadOperation(sr, args);
  if (!identity) {
    const created = await sr.entities.UsageOperation.create({
      workspace_id: args.workspaceId,
      operation_key: args.operationKey,
      metric: args.metric,
      units,
      state: "reserved",
      window_id: "",
      source_ref: args.sourceRef || "",
      payload_fingerprint: args.payloadFingerprint || "",
    });
    const rows = asArray<UsageOperationRecord>(
      (await sr.entities.UsageOperation.filter(
        { workspace_id: args.workspaceId, operation_key: args.operationKey },
        { sort: "created_date" }
      )) as UsageOperationRecord[]
    );
    identity = rows[0] || created;
    for (let i = 1; i < rows.length; i++) {
      const dup = rows[i];
      if (dup.state === "reserved" && dup.window_id) {
        // A duplicate that somehow already owns a charge gives the unit back
        // before removal, so the identity holds exactly one reservation.
        try {
          await sr.entities.UsageWindow.updateMany(
            { id: dup.window_id },
            { $inc: { reserved: -(dup.units || units) } }
          );
        } catch {
          // Window already gone.
        }
      }
      try {
        await sr.entities.UsageOperation.delete(dup.id);
      } catch {
        // Already removed by a concurrent resolver.
      }
    }
  }

  // The same logical operation with a different payload is a conflict, whatever
  // state that operation is currently in.
  if (
    identity.payload_fingerprint &&
    args.payloadFingerprint &&
    identity.payload_fingerprint !== args.payloadFingerprint
  ) {
    return { allowed: false, reason: "operation_conflict", operation_id: identity.id };
  }
  if (!identity.payload_fingerprint && args.payloadFingerprint) {
    // Recorded before payloads were fingerprinted; the two cannot be compared
    // retroactively, so adopt this fingerprint and hold the identity to it.
    try {
      await sr.entities.UsageOperation.update(identity.id, {
        payload_fingerprint: args.payloadFingerprint,
      });
    } catch {
      // Non-fatal: the reservation itself is unaffected.
    }
  }

  // Already charged by an earlier or concurrent attempt: recover that reservation.
  // Even after a period rollover it stays tied to the window it was created in and
  // never spends the new period's allowance.
  if (identity.window_id && (identity.state === "reserved" || identity.state === "consumed")) {
    return {
      allowed: true,
      duplicate: true,
      operation_id: identity.id,
      window_id: identity.window_id,
      state: identity.state,
    };
  }
  // An uncharged row (state "released"/"failed", or created moments ago) falls
  // through and claims its charge below, so a retry can never double-charge.

  const allowance = windowedAllowance(billing, cfg.windowKey);
  if (allowance == null) return { allowed: true, unenforced: true };

  let target = await resolveWindow(sr, args.workspaceId, cfg.windowKey, window, allowance);

  // Claim the charge. Only the caller that moves the identity from "uncharged"
  // (empty window_id) to a window performs the increment, so one identity can be
  // charged exactly once even when two attempts race.
  const claim = await sr.entities.UsageOperation.updateMany(
    { id: identity.id, window_id: "" },
    {
      $set: {
        metric: args.metric,
        units,
        state: "reserved",
        window_id: target.id,
        source_ref: args.sourceRef || "",
        payload_fingerprint: args.payloadFingerprint || "",
      },
    }
  );
  if (!claim.updated) {
    const again = await loadOperation(sr, args);
    if (again && again.window_id) {
      return {
        allowed: true,
        duplicate: true,
        operation_id: again.id,
        window_id: again.window_id,
        state: again.state,
      };
    }
    // Claimed but not yet chargeable — retry rather than guess.
    return { allowed: false, reason: "unavailable" };
  }

  // Atomic conditional increment on the resolved window. A concurrent first use
  // can fold that row into the surviving row — single-datastore read lag makes
  // this reachable — so move the charge to the survivor and retry once rather
  // than leaving a racing caller without a decision.
  let charged: UsageWindowRecord | null = null;
  for (let attempt = 0; attempt < 2 && !charged; attempt++) {
    await sr.entities.UsageWindow.updateMany({ id: target.id }, { $inc: { reserved: units } });
    try {
      charged = await sr.entities.UsageWindow.get(target.id);
    } catch {
      target = await resolveWindow(sr, args.workspaceId, cfg.windowKey, window, allowance);
      await sr.entities.UsageOperation.updateMany(
        { id: identity.id },
        { $set: { window_id: target.id } }
      );
    }
  }
  if (!charged) {
    await sr.entities.UsageOperation.updateMany(
      { id: identity.id },
      { $set: { window_id: "", state: "released" } }
    );
    return { allowed: false, reason: "unavailable" };
  }

  const committed = (charged.used || 0) + (charged.reserved || 0);
  if (committed > allowance) {
    await sr.entities.UsageWindow.updateMany({ id: target.id }, { $inc: { reserved: -units } });
    // Release the charge claim so this identity can be reserved later, once
    // capacity has been freed. Counters stay consistent either way.
    await sr.entities.UsageOperation.updateMany(
      { id: identity.id },
      { $set: { window_id: "", state: "released" } }
    );
    return {
      allowed: false,
      reason: "limit_reached",
      used: charged.used || 0,
      allowance,
      remaining: Math.max(0, allowance - (charged.used || 0)),
    };
  }

  return { allowed: true, operation_id: identity.id, window_id: target.id, allowance };
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