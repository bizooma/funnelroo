import type { ServiceRoleClient } from "./models.ts";
import { computeFingerprint } from "./auth.ts";
import {
  reserveUsage,
  consumeUsage,
  releaseUsage,
  checkCapacity,
  countCapacity,
  type CapacityMetric,
  type MeteringMetric,
  type ReserveResult,
} from "./usage.ts";

// One enforcement surface for every customer action.
//
// Every gated path calls beginMeteredAction() BEFORE the paid external work and
// then complete or abort it with the SAME logical operation identity. The
// identity is supplied by the caller (a client request id when there is one) so
// a retry of the same logical action resolves to the same reservation instead of
// spending a second unit.

export interface MeterDecision {
  allowed: boolean;
  enforcement: boolean;
  /** Present when allowed; carry it into complete/abort. */
  handle: {
    enforcement: boolean;
    operationId?: string;
    duplicate?: boolean;
    allowance?: number | null;
  };
  /** Present when not allowed. */
  report?: LimitReport;
}

export interface LimitReport {
  ok: false;
  metric: string;
  reason: string;
  enforcement: boolean;
  access_state?: string;
  allowance?: number | null;
  used?: number;
  remaining?: number | null;
  status: number;
  message: string;
}

export interface CapacityDecision {
  allowed: boolean;
  enforcement: boolean;
  used: number;
  allowance: number | null;
  report?: LimitReport;
}

export const METRIC_LABEL: Record<string, string> = {
  email_send: "email sends",
  ai_text: "AI text actions",
  image: "generated images",
  live_funnels: "live funnels",
  team_users: "team users",
  contacts: "stored contacts",
};

export function operationKeyFor(action: string, ...parts: Array<string | number | null | undefined>): string {
  return [action, ...parts.filter((p) => p !== null && p !== undefined && p !== "")]
    .map((p) => String(p))
    .join(":");
}

export function randomOperationKey(action: string): string {
  return `${action}:${crypto.randomUUID()}`;
}

const ACCESS_MESSAGE: Record<string, string> = {
  read_only: "Your plan is read-only right now, so no new work can start. Renew or upgrade to continue.",
  payment_grace: "Your payment needs attention. Update your billing details to keep starting new work.",
  none: "Start a trial or choose a plan to use this feature.",
};

function limitReport(metric: string, reason: string, fields: Partial<LimitReport> = {}): LimitReport {
  const label = METRIC_LABEL[metric] || "usage";
  let message: string;
  let status = 409;

  if (reason === "access_blocked") {
    message = ACCESS_MESSAGE[fields.access_state || ""] || "This workspace can't start new work right now.";
    message += " Your existing funnels, contacts and exports are unaffected.";
  } else if (reason === "limit_reached" || reason === "capacity_reached") {
    const allowance = fields.allowance ?? null;
    message =
      allowance != null
        ? `You've used all ${allowance.toLocaleString()} ${label} included this period. Upgrade your plan or wait for the next period to reset.`
        : `You've reached your ${label} limit. Upgrade your plan to continue.`;
  } else if (reason === "operation_conflict") {
    status = 409;
    message = "This request was already processed with different details.";
  } else {
    message = "This action is unavailable right now.";
  }

  return {
    ok: false,
    metric,
    reason,
    enforcement: true,
    status,
    message,
    ...fields,
  };
}

export function httpStatusForLimit(report: LimitReport): number {
  return report.status || 409;
}

export function limitBody(report: LimitReport): Record<string, unknown> {
  return {
    error: report.message,
    limit: {
      metric: report.metric,
      reason: report.reason,
      allowance: report.allowance ?? null,
      used: report.used ?? null,
      remaining: report.remaining ?? null,
    },
  };
}

/**
 * Reserve capacity for a metered action. Returns a decision; when allowed, the
 * handle must be passed to completeMeteredAction or abortMeteredAction.
 */
export async function beginMeteredAction(
  sr: ServiceRoleClient,
  args: {
    workspaceId: string;
    action: string;
    metric: MeteringMetric;
    operationKey?: string;
    payload?: unknown;
    units?: number;
  }
): Promise<MeterDecision> {
  const operationKey = args.operationKey || randomOperationKey(args.action);
  const result: ReserveResult = await reserveUsage(sr, {
    workspaceId: args.workspaceId,
    metric: args.metric,
    operationKey,
    units: args.units,
    sourceRef: args.action,
    payloadFingerprint: args.payload === undefined ? undefined : computeFingerprint(args.payload),
  });

  if (!result.allowed) {
    return {
      allowed: false,
      enforcement: true,
      handle: { enforcement: true },
      report: limitReport(args.metric, result.reason || "unavailable", {
        access_state: result.access_state,
        allowance: result.allowance ?? null,
        used: result.used,
        remaining: result.remaining ?? null,
      }),
    };
  }

  return {
    allowed: true,
    enforcement: result.enforcement !== false,
    handle: {
      enforcement: result.enforcement !== false,
      operationId: result.operation_id,
      duplicate: result.duplicate,
      allowance: result.allowance ?? null,
    },
  };
}

/** Promote the reservation after the paid work succeeded. */
export async function completeMeteredAction(
  sr: ServiceRoleClient,
  decision: MeterDecision,
  workspaceId: string
): Promise<void> {
  if (!decision.handle.operationId) return;
  await consumeUsage(sr, { workspaceId, operationId: decision.handle.operationId }).catch(() => {});
}

/** Release the reservation when the paid work failed or was not performed. */
export async function abortMeteredAction(
  sr: ServiceRoleClient,
  decision: MeterDecision,
  workspaceId: string
): Promise<void> {
  if (!decision.handle.operationId) return;
  await releaseUsage(sr, { workspaceId, operationId: decision.handle.operationId }).catch(() => {});
}

/**
 * Check a capacity gauge (live funnels / team users / contacts). Not a
 * reservation: the caller counts the current usage plus the unit it is about to
 * create. Enforcement is on only for designated test workspaces.
 */
export async function guardCapacity(
  sr: ServiceRoleClient,
  args: { workspaceId: string; metric: CapacityMetric; delta?: number }
): Promise<CapacityDecision> {
  const delta = args.delta || 1;
  const used = await countCapacity(sr, args.workspaceId, args.metric);
  const result = await checkCapacity(sr, {
    workspaceId: args.workspaceId,
    used: used + (delta - 1),
    metricKey: args.metric,
  });
  if (result.allowed) {
    return { allowed: true, enforcement: result.enforcement, used, allowance: result.allowance };
  }
  return {
    allowed: false,
    enforcement: true,
    used,
    allowance: result.allowance,
    report: limitReport(args.metric, "capacity_reached", {
      allowance: result.allowance,
      used,
      remaining: result.allowance == null ? null : Math.max(0, result.allowance - used),
    }),
  };
}