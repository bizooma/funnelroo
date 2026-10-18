// Shared billing state logic: access-state computation, trial dates, and paid
// usage-window anchoring. Pure functions with no Stripe or entity access —
// callers (backend functions) read/write entities and pass records in.
//
// Access states are deliberately separate from Stripe subscription status.
// Stripe tells us whether a payment instrument is active; these states tell
// us what FunnelRoo access the workspace has.

import { TRIAL } from "./plans.ts";

export const ACCESS_STATES = {
  NONE: "none", // no billing record yet
  TRIAL: "trial",
  PAID: "paid",
  PAYMENT_GRACE: "payment_grace",
  READ_ONLY: "read_only",
  LEGACY_ACCESS: "legacy_access",
};

// Compute the effective access state from a WorkspaceBilling record and now.
// Does NOT mutate; callers persist transitions explicitly.
export function computeAccessState(billing, nowMs) {
  if (!billing) return ACCESS_STATES.NONE;
  if (billing.legacy_access) return ACCESS_STATES.LEGACY_ACCESS;
  const now = nowMs || Date.now();
  if (billing.status === "trial") {
    const ends = billing.trial_ends_at ? new Date(billing.trial_ends_at).getTime() : 0;
    return ends > now ? ACCESS_STATES.TRIAL : ACCESS_STATES.READ_ONLY;
  }
  if (billing.status === "paid") {
    const through = billing.paid_through ? new Date(billing.paid_through).getTime() : 0;
    if (through > now) return ACCESS_STATES.PAID;
    // Past paid-through with no renewal: grace until reconciliation resolves it.
    return ACCESS_STATES.PAYMENT_GRACE;
  }
  if (billing.status === "payment_grace") return ACCESS_STATES.PAYMENT_GRACE;
  if (billing.status === "read_only") return ACCESS_STATES.READ_ONLY;
  if (billing.status === "canceled") {
    const through = billing.paid_through ? new Date(billing.paid_through).getTime() : 0;
    return through > now ? ACCESS_STATES.PAID : ACCESS_STATES.READ_ONLY;
  }
  return ACCESS_STATES.READ_ONLY;
}

export function trialEndDate(startedAtIso, durationDays) {
  const start = new Date(startedAtIso || new Date().toISOString());
  const end = new Date(start.getTime() + (durationDays || TRIAL.duration_days) * 86400000);
  return end.toISOString();
}

export function daysRemaining(endIso) {
  if (!endIso) return 0;
  const ms = new Date(endIso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

// Paid usage window: monthly reset anchored to the first paid period start.
// Half-open [start, start+1month), anchored to the original UTC day across
// short months and leap years. Annual billing does NOT grant 12 months
// upfront — the window is still one month.
export function currentMonthlyWindow(anchorIso, nowMs) {
  const now = new Date(nowMs || Date.now());
  const anchor = new Date(anchorIso || now.toISOString());
  const anchorDay = anchor.getUTCDate();
  let start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), anchorDay));
  if (start.getTime() > now.getTime()) {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, anchorDay));
  }
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, anchorDay));
  return { start: start.toISOString(), end: end.toISOString() };
}

// The usage window for a metric given the billing record. Trial uses the trial
// period [trial_started_at, trial_ends_at]; paid uses the monthly anniversary;
// none/legacy returns null (no enforced window yet).
export function usageWindowFor(billing, metric) {
  if (!billing) return null;
  if (billing.status === "trial" && billing.trial_started_at && billing.trial_ends_at) {
    return { start: billing.trial_started_at, end: billing.trial_ends_at };
  }
  if (billing.status === "paid" && billing.paid_window_anchor) {
    return currentMonthlyWindow(billing.paid_window_anchor);
  }
  return null;
}

// Whether a given access state permits new gated (metered/paid) operations.
// Legacy access and none are NOT automatically entitled to new paid work in
// the enforcement phase; this returns true only for active trial/paid/grace.
export function canPerformGatedAction(accessState) {
  return (
    accessState === ACCESS_STATES.TRIAL ||
    accessState === ACCESS_STATES.PAID ||
    accessState === ACCESS_STATES.PAYMENT_GRACE ||
    accessState === ACCESS_STATES.LEGACY_ACCESS
  );
}