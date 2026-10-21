import { mapSubscription } from "./subscriptionSync.ts";
import { validatePrice, expectedTerms } from "./stripeCatalog.ts";

// Isolated mock Stripe adapter + local fixtures. TEST ENVIRONMENT ONLY.
//
// Used by the billing self-test to exercise the SAME mapping/validation logic
// the real handlers use, without a live Stripe key. A mock subscription is a
// plain object shaped like the Stripe API, so mapSubscription() (the real
// handler logic) is what runs — not a copy. Mocks never write paid access to a
// production workspace: the self-test asserts on the returned mapping only and
// the mock path is gated behind an explicitly designated test workspace.

export function fixtureSubscription(overrides = {}) {
  const base = {
    id: "sub_fixture",
    object: "subscription",
    status: "active",
    customer: "cus_fixture",
    metadata: { workspace_id: "ws_fixture" },
    cancel_at_period_end: false,
    canceled_at: null,
    current_period_start: Math.floor(Date.now() / 1000) - 86400,
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    items: {
      data: [
        {
          id: "si_fixture",
          current_period_start: Math.floor(Date.now() / 1000) - 86400,
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          price: { id: "price_starter_month", lookup_key: "funnelroo_starter_month" },
        },
      ],
    },
  };
  return {
    ...base,
    ...overrides,
    items: overrides.items || base.items,
    metadata: overrides.metadata || base.metadata,
  };
}

export function fixturePrice(planId, interval, overrides = {}) {
  const exp = expectedTerms(planId, interval);
  return {
    id: `price_${planId}_${interval}`,
    object: "price",
    active: true,
    currency: exp.currency,
    unit_amount: exp.amount,
    lookup_key: `funnelroo_${planId}_${interval === "annual" ? "year" : "month"}`,
    recurring: { interval: exp.recurring, usage_type: "licensed" },
    ...overrides,
  };
}

// Run the real mapping against a set of fixtures and assert each expected
// outcome. Returns a report; performs no writes.
export function runSyncFixtures() {
  const cases = [
    { name: "active_starter_month", sub: fixtureSubscription(), expect: { status: "paid", plan: "starter", interval: "monthly" } },
    {
      name: "active_growth_annual",
      sub: fixtureSubscription({ items: { data: [{ id: "si2", price: { id: "p2", lookup_key: "funnelroo_growth_year" } }] } }),
      expect: { status: "paid", plan: "growth", interval: "annual" },
    },
    { name: "past_due_grace", sub: fixtureSubscription({ status: "past_due" }), expect: { status: "payment_grace" } },
    { name: "canceled", sub: fixtureSubscription({ status: "canceled", canceled_at: Math.floor(Date.now() / 1000) }), expect: { status: "canceled" } },
    { name: "incomplete_read_only", sub: fixtureSubscription({ status: "incomplete" }), expect: { status: "read_only" } },
    { name: "cancel_at_period_end", sub: fixtureSubscription({ cancel_at_period_end: true }), expect: { cancel_at_period_end: true } },
  ];
  return cases.map((c) => {
    const mapped = mapSubscription(c.sub);
    const mismatches = Object.entries(c.expect).filter(([k, v]) => mapped[k] !== v);
    return { case: c.name, pass: mismatches.length === 0, mapped, mismatches };
  });
}

export function runPriceFixtures() {
  const checks = [];
  for (const planId of ["starter", "growth"]) {
    for (const interval of ["monthly", "annual"]) {
      const good = validatePrice(fixturePrice(planId, interval), planId, interval);
      const wrongAmount = validatePrice(fixturePrice(planId, interval, { unit_amount: 1 }), planId, interval);
      const wrongInterval = validatePrice(fixturePrice(planId, interval, { recurring: { interval: interval === "annual" ? "month" : "year" } }), planId, interval);
      checks.push(
        { case: `${planId}_${interval}_valid`, pass: good.valid === true, detail: good },
        { case: `${planId}_${interval}_amount_rejected`, pass: wrongAmount.valid === false && wrongAmount.reason === "amount_mismatch", detail: wrongAmount },
        { case: `${planId}_${interval}_interval_rejected`, pass: wrongInterval.valid === false && wrongInterval.reason === "interval_mismatch", detail: wrongInterval }
      );
    }
  }
  return checks;
}