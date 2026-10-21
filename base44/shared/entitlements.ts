import { computeAccessState, ACCESS_STATES } from "./billing.ts";
import { getPlan, TRIAL } from "./plans.ts";

export { ACCESS_STATES };

// Enforcement is OFF unless a workspace is explicitly designated. This is what
// keeps existing working accounts unrestricted even after Stripe keys are set:
// only designated test workspaces (enforcement_enabled=true) are metered.
export function enforcementEnabled(billing) {
  return !!(billing && billing.enforcement_enabled === true);
}

// Whether a workspace may perform a gated (paid/metered) action.
export function canPerformGatedAction(billing) {
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
export function windowedAllowance(billing, metricKey) {
  if (!billing) return null;
  if (billing.status === "trial") {
    return TRIAL.allowances[`${metricKey}_total`] ?? null;
  }
  const plan = billing.plan ? getPlan(billing.plan) : null;
  if (!plan) return null;
  return plan.allowances[`${metricKey}_per_month`] ?? null;
}

// Effective allowance for a capacity gauge (live funnels / team users / contacts).
export function capacityAllowance(billing, metricKey) {
  if (!billing) return null;
  if (billing.status === "trial") {
    return TRIAL.allowances[metricKey] ?? null;
  }
  const plan = billing.plan ? getPlan(billing.plan) : null;
  if (!plan) return null;
  return plan.allowances[metricKey] ?? null;
}