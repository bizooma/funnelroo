import { PLANS, CATALOG_VERSION, CURRENCY } from "./plans.ts";

// Stripe ↔ application catalog mapping. Prices are provisioned with stable
// lookup_keys so a re-provision can find them without hardcoding opaque IDs,
// and so subscription sync can derive the plan/interval directly from a
// subscription item's price.
export const ENVIRONMENT = "test";
export const APP_TAG = "funnelroo";

export const PRICE_LOOKUP = {
  starter: { monthly: "funnelroo_starter_month", annual: "funnelroo_starter_year" },
  growth: { monthly: "funnelroo_growth_month", annual: "funnelroo_growth_year" },
};

export function keyFor(planId, interval) {
  const plan = PRICE_LOOKUP[planId];
  if (!plan) return null;
  return interval === "annual" ? plan.annual : plan.monthly;
}

export function parseLookupKey(lk) {
  const m = /^funnelroo_(starter|growth)_(month|year)$/.exec(lk || "");
  if (!m) return null;
  return { plan: m[1], interval: m[2] === "year" ? "annual" : "monthly" };
}

// Expected terms for a (plan, interval) pair, straight from the approved catalog.
export function expectedTerms(planId, interval) {
  const plan = PLANS[planId];
  if (!plan) return null;
  const annual = interval === "annual";
  const price = annual ? plan.prices.annual : plan.prices.monthly;
  return {
    plan: planId,
    interval,
    amount: price.amount,
    currency: CURRENCY,
    recurring: annual ? "year" : "month",
  };
}

// Validate a fetched Stripe Price against the approved catalog terms. Returns
// { valid, reason?, terms? } — used at provisioning and in admin validation.
export function validatePrice(price, planId, interval) {
  const exp = expectedTerms(planId, interval);
  if (!exp) return { valid: false, reason: "unknown_plan_interval" };
  if (!price) return { valid: false, reason: "missing_price" };
  if ((price.currency || "").toLowerCase() !== exp.currency) {
    return { valid: false, reason: "currency_mismatch", got: price.currency, expected: exp.currency };
  }
  if (price.unit_amount !== exp.amount) {
    return { valid: false, reason: "amount_mismatch", got: price.unit_amount, expected: exp.amount };
  }
  if (price.recurring?.interval !== exp.recurring) {
    return { valid: false, reason: "interval_mismatch", got: price.recurring?.interval, expected: exp.recurring };
  }
  if (price.recurring?.usage_type && price.recurring.usage_type !== "licensed") {
    return { valid: false, reason: "not_licensed", got: price.recurring.usage_type };
  }
  if (price.active === false) return { valid: false, reason: "inactive" };
  return { valid: true, terms: exp };
}

export const CATALOG_PIN = {
  catalog_version: CATALOG_VERSION,
  sdk: "17.7.0",
  environment: ENVIRONMENT,
};