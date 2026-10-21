import Stripe from "npm:stripe@17.7.0";
import { secrets } from "base44:runtime";

// Pinned Stripe SDK. The API version is pinned by the SDK release — we do NOT
// pass an apiVersion override, so the version can never drift with the account
// or at runtime. Bump STRIPE_SDK_VERSION deliberately, together with a catalog
// review, when Stripe requires it.
export const STRIPE_SDK_VERSION = "17.7.0";

export class StripeConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "StripeConfigError";
    this.status = 503;
  }
}

export function stripeKey() {
  return secrets.get("STRIPE_SECRET_KEY") || "";
}

export function webhookSecret() {
  return secrets.get("STRIPE_WEBHOOK_SECRET") || "";
}

export function stripeEnvironment() {
  const k = stripeKey();
  if (k.startsWith("sk_live_")) return "live";
  if (k.startsWith("sk_test_")) return "test";
  return "unknown";
}

export function isStripeConfigured() {
  return /^sk_(test|live)_/.test(stripeKey());
}

export function isWebhookSigningConfigured() {
  return /^whsec_/.test(webhookSecret());
}

// Construct the Stripe client. Throws a StripeConfigError (fail-closed) when the
// key is absent or malformed — it never returns a client that could be used to
// fabricate a checkout URL or provider record.
export function getStripeClient() {
  const k = stripeKey();
  if (!k) {
    throw new StripeConfigError(
      "Stripe is not configured yet. Set STRIPE_SECRET_KEY (test mode) in Secrets."
    );
  }
  if (!/^sk_(test|live)_/.test(k)) {
    throw new StripeConfigError("STRIPE_SECRET_KEY is not a valid Stripe secret key.");
  }
  return new Stripe(k, {
    maxNetworkRetries: 2,
    appInfo: { name: "FunnelRoo", version: "1.0" },
  });
}

// Phase guard: only test-mode keys are permitted. Live keys are rejected so no
// live charges, products, or destinations can be created from this build.
export function assertTestMode() {
  const env = stripeEnvironment();
  if (env === "live") {
    throw new StripeConfigError(
      "Live Stripe keys are not permitted in this phase. Configure test-mode keys."
    );
  }
  if (env !== "test") {
    throw new StripeConfigError("Stripe test-mode key not configured.");
  }
  return env;
}