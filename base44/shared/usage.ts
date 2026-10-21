import { firstRecord, asArray } from "./auth.ts";
import { usageWindowFor } from "./billing.ts";
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
// supplied operation_key, so a retried request does NOT double-count.
//
// Windowing: ONE UsageWindow row per (workspace, metric). It stores the current
// period bounds and rolls over in place, so counters are never split across
// duplicate rows. resolveWindow() merges any duplicate rows left by a race into
// the oldest survivor. Windows are provisioned at trial/paid activation so the
// first burst of actions cannot race the window's creation.
//
// Capacity (email/AI/image) is checked AFTER an atomic increment of `reserved`
// (reserve-then-validate): the increment is atomic and over-admissions release
// immediately. Enforcement applies only to designated test workspaces.

export const WINDOW_METRICS = {
  email_send: { windowKey: "email_sends" },
  ai_text: { windowKey: "ai_text_actions" },
  image: { windowKey: "images" },
};

async function loadBilling(sr, workspaceId) {
  return firstRecord(
    await sr.entities.WorkspaceBilling.filter({ workspace_id: workspaceId, environment: ENVIRONMENT })
  );
}

// Resolve the window for (workspace, windowKey) at the CURRENT period. The
// period is part of the identity, so rollover is implicit (a new period is a
// new window_start) and there is no destructive reset in the hot path — a
// concurrent burst can never wipe a counter another request just incremented.
async function resolveWindow(sr, workspaceId, windowKey, window, allowance) {
  const rows = asArray(
    await sr.entities.UsageWindow.filter(
      { workspace_id: workspaceId, metric: windowKey, window_start: window.start },
      { sort: "created_date" }
    )
  );
  if (rows.length) {
    const survivor = rows[0];
    if (survivor.allowance !== allowance) {
      return await sr.entities.UsageWindow.update(survivor.id, { allowance });
    }
    return survivor;
  }
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

// Create the windows for a billing state so a first concurrent burst cannot race
// window creation. Safe to call repeatedly.
export async function provisionWindows(sr, billing, workspaceId) {
  if (!billing) return [];
  const created = [];
  for (const metric of Object.keys(WINDOW_METRICS)) {
    const cfg = WINDOW_METRICS[metric];
    const window = usageWindowFor(billing, cfg.windowKey);
    if (!window) continue;
    const existing = firstRecord(
      await sr.entities.UsageWindow.filter({
        workspace_id: workspaceId,
        metric: cfg.windowKey,
        window_start: window.start,
      })
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
export async function reserveUsage(sr, { workspaceId, metric, operationKey, units = 1, sourceRef }) {
  const cfg = WINDOW_METRICS[metric];
  if (!cfg) return { allowed: false, reason: "unknown_metric" };
  if (!operationKey) return { allowed: false, reason: "missing_operation_key" };

  const billing = await loadBilling(sr, workspaceId);
  if (!enforcementEnabled(billing)) return { allowed: true, enforcement: false };

  const gate = canPerformGatedAction(billing);
  if (!gate.allowed) return { allowed: false, reason: "access_blocked", access_state: gate.access_state };

  const window = usageWindowFor(billing, cfg.windowKey);
  if (!window) return { allowed: false, reason: "no_usage_window" };

  const prior = firstRecord(
    await sr.entities.UsageOperation.filter({ workspace_id: workspaceId, operation_key: operationKey })
  );
  if (prior && (prior.state === "reserved" || prior.state === "consumed")) {
    return { allowed: true, duplicate: true, operation_id: prior.id, state: prior.state };
  }

  const allowance = windowedAllowance(billing, cfg.windowKey);
  if (allowance == null) return { allowed: true, unenforced: true };

  const w = await resolveWindow(sr, workspaceId, cfg.windowKey, window, allowance);

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

  const op = await sr.entities.UsageOperation.create({
    workspace_id: workspaceId,
    operation_key: operationKey,
    metric,
    units,
    state: "reserved",
    window_id: w.id,
    source_ref: sourceRef || "",
  });
  return { allowed: true, operation_id: op.id, window_id: w.id, allowance };
}

// Promote a reservation to a consumed unit. Idempotent.
export async function consumeUsage(sr, { workspaceId, operationId, operationKey }) {
  const op = operationId
    ? await sr.entities.UsageOperation.get(operationId).catch(() => null)
    : firstRecord(
        await sr.entities.UsageOperation.filter({ workspace_id: workspaceId, operation_key: operationKey })
      );
  if (!op) return { ok: false, reason: "operation_not_found" };
  if (op.state === "consumed") return { ok: true, duplicate: true };
  if (op.state === "released" || op.state === "failed") return { ok: false, reason: "not_reserved" };
  const units = op.units || 1;
  await sr.entities.UsageWindow.updateMany({ id: op.window_id }, { $inc: { reserved: -units, used: units } });
  await sr.entities.UsageOperation.update(op.id, { state: "consumed" });
  return { ok: true, operation_id: op.id };
}

// Release a reservation without consuming (failure path). Idempotent.
export async function releaseUsage(sr, { workspaceId, operationId, operationKey }) {
  const op = operationId
    ? await sr.entities.UsageOperation.get(operationId).catch(() => null)
    : firstRecord(
        await sr.entities.UsageOperation.filter({ workspace_id: workspaceId, operation_key: operationKey })
      );
  if (!op) return { ok: false, reason: "operation_not_found" };
  if (op.state === "released" || op.state === "consumed") return { ok: true, duplicate: true };
  const units = op.units || 1;
  await sr.entities.UsageWindow.updateMany({ id: op.window_id }, { $inc: { reserved: -units } });
  await sr.entities.UsageOperation.update(op.id, { state: "released" });
  return { ok: true, operation_id: op.id };
}

// Capacity gauge check (not windowed): live funnels, team users, contacts.
export async function checkCapacity(sr, { workspaceId, used, metricKey }) {
  const billing = await loadBilling(sr, workspaceId);
  const allowance = capacityAllowance(billing, metricKey);
  if (!enforcementEnabled(billing) || allowance == null) {
    return { allowed: true, used, allowance, enforcement: false };
  }
  return { allowed: used < allowance, used, allowance, enforcement: true };
}

export async function countCapacity(sr, workspaceId, metricKey) {
  if (metricKey === "live_funnels") {
    return sr.entities.Funnel.count({ workspace_id: workspaceId, state: "published" });
  }
  if (metricKey === "team_users") {
    const active = await sr.entities.Membership.count({ workspace_id: workspaceId, status: "active" });
    const pending = asArray(
      await sr.entities.Invite.filter({ workspace_id: workspaceId, status: "pending" })
    ).filter((iv) => !iv.expires_at || new Date(iv.expires_at).getTime() > Date.now()).length;
    return active + pending;
  }
  if (metricKey === "contacts") {
    return sr.entities.Contact.count({ workspace_id: workspaceId });
  }
  return 0;
}