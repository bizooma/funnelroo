import type { WorkspaceBillingRecord } from "./models.ts";
import { computeAccessState, ACCESS_STATES, type AccessState } from "./billing.ts";
import { getPlan, TRIAL, type PlanAllowances, type TrialAllowances } from "./plans.ts";
import type { CapacityMetric } from "./usage.ts";

export { ACCESS_STATES };
export type { AccessState };

export interface GateResult {
  allowed: boolean;
  enforcement: boolean;
  access_state?: AccessState;
}

// Read a numeric allowance by key. The catalog objects are declared with named
// keys, so a dynamic key lands here and is type-checked once.
function pickAllowance(
  source: TrialAllowances | PlanAllowances,
  key: string
): number | null {
  const value = (source as unknown as Record<string, number | undefined>)[key];
  return typeof value === "number" ? value : null;
}

// Enforcement is OFF unless a workspace is explicitly designated. This is what
// keeps existing working accounts unrestricted even after Stripe keys are set:
// only designated test workspaces (enforcement_enabled=true) are metered.
export function enforcementEnabled(
  billing: WorkspaceBillingRecord | null | undefined
): boolean {
  return !!(billing && billing.enforcement_enabled === true);
}

// Whether a workspace may perform a gated (paid/metered) action.
export function canPerformGatedAction(
  billing: WorkspaceBillingRecord | null | undefined
): GateResult {
  if (!enforcementEnabled(billing)) {
    return { allowed: true, enforcement: false };
  }
  const access = computeAccessState(billing);
  const allowed =
    access === ACCESS_STATES.TRIAL ||
    access === ACCESS_STATES.PAID ||
    access === ACCESS_STATES.PAYMENT_GRACE;
  return { allowed, enforcement: true, access_state: access };
}

// Effective allowance for a windowed metric under the current billing state.
// Trial uses the *_total keys; a paid plan uses the *_per_month keys.
export function windowedAllowance(
  billing: WorkspaceBillingRecord | null | undefined,
  metricKey: string
): number | null {
  if (!billing) return null;
  if (billing.status === "trial") {
    return pickAllowance(TRIAL.allowances, `${metricKey}_total`);
  }
  const plan = billing.plan ? getPlan(billing.plan) : null;
  if (!plan) return null;
  return pickAllowance(plan.allowances, `${metricKey}_per_month`);
}

// Effective allowance for a capacity gauge (live funnels / team users / contacts).
export function capacityAllowance(
  billing: WorkspaceBillingRecord | null | undefined,
  metricKey: CapacityMetric
): number | null {
  if (!billing) return null;
  if (billing.status === "trial") {
    return pickAllowance(TRIAL.allowances, metricKey);
  }
  const plan = billing.plan ? getPlan(billing.plan) : null;
  if (!plan) return null;
  return pickAllowance(plan.allowances, metricKey);
}