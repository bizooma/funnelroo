import Stripe, { type StripeClient } from "npm:stripe@17.7.0";
import { secrets } from "base44:runtime";

// Pinned Stripe SDK. The request API version is pinned by the SDK release — we
// do NOT pass an apiVersion override, so it cannot drift with the account.
export const STRIPE_SDK_VERSION = "17.7.0";

// The exact `api_version` Stripe stamps on events delivered to this app. Stripe
// stamps each event with the API version of the account's default (or the
// destination's pinned version). The webhook handler parses the event with this
// SDK, so the destination MUST pin this version — otherwise Stripe sends a
// payload shape the SDK's types and this handler do not describe.
//
// The SDK's own request version is the source of truth for this string; it is
// reported (never guessed) by verifyingCredentials so the destination can be
// matched to it.
export function stripeRequestApiVersion(): string {
  // Stripe.ApiVersion is the version this SDK sends and expects.
  const v = (Stripe as unknown as { ApiVersion?: string }).ApiVersion;
  return typeof v === "string" && v ? v : "unknown";
}

export class StripeConfigError extends Error {
  status: number;
  code: string;
  constructor(message: string, code = "stripe_config_error", status = 503) {
    super(message);
    this.name = "StripeConfigError";
    this.status = status;
    this.code = code;
  }
}

export function stripeKey(): string {
  return secrets.get("STRIPE_SECRET_KEY") || "";
}

export function webhookSecret(): string {
  return secrets.get("STRIPE_WEBHOOK_SECRET") || "";
}

// Stripe issues both unrestricted secret keys (sk_*) and restricted keys (rk_*),
// live and test. All four grant API access; a restricted key is legitimate and
// is verified the same way (Stripe returns 403 for a permission it lacks).
export type CredentialKind =
  | "missing"
  | "placeholder"
  | "unsupported_format"
  | "secret_test"
  | "secret_live"
  | "restricted_test"
  | "restricted_live";

const PLACEHOLDER_RE = /^(sk|rk)_(test|live)_(x+|your|placeholder|changeme|abc123|test|secret)\b/i;

/** Classify the raw credential WITHOUT contacting Stripe and WITHOUT exposing it. */
export function classifyCredential(raw: string): CredentialKind {
  const k = (raw || "").trim();
  if (!k) return "missing";
  if (PLACEHOLDER_RE.test(k) || k.length < 24) {
    // Too short to be a real key, or an obvious placeholder value.
    if (!/^(sk|rk)_(test|live)_/.test(k)) return "unsupported_format";
    return "placeholder";
  }
  if (/^sk_test_/.test(k)) return "secret_test";
  if (/^sk_live_/.test(k)) return "secret_live";
  if (/^rk_test_/.test(k)) return "restricted_test";
  if (/^rk_live_/.test(k)) return "restricted_live";
  return "unsupported_format";
}

export function credentialIsTest(kind: CredentialKind): boolean {
  return kind === "secret_test" || kind === "restricted_test";
}

export function credentialIsLive(kind: CredentialKind): boolean {
  return kind === "secret_live" || kind === "restricted_live";
}

export function credentialIsStripeKey(kind: CredentialKind): boolean {
  return credentialIsTest(kind) || credentialIsLive(kind);
}

export function stripeEnvironment(): "test" | "live" | "unknown" {
  const kind = classifyCredential(stripeKey());
  if (credentialIsTest(kind)) return "test";
  if (credentialIsLive(kind)) return "live";
  return "unknown";
}

export function isStripeConfigured(): boolean {
  return credentialIsStripeKey(classifyCredential(stripeKey()));
}

export function isWebhookSigningConfigured(): boolean {
  return /^whsec_/.test((webhookSecret() || "").trim());
}

// Construct the Stripe client. Throws a StripeConfigError (fail-closed) when the
// key is absent or malformed — it never returns a client that could be used to
// fabricate a checkout URL or provider record.
export function getStripeClient(): StripeClient {
  const raw = stripeKey();
  const kind = classifyCredential(raw);
  if (kind === "missing") {
    throw new StripeConfigError(
      "Stripe is not configured yet. Set STRIPE_SECRET_KEY (test mode) in Secrets.",
      "missing_credential"
    );
  }
  if (kind === "placeholder") {
    throw new StripeConfigError(
      "STRIPE_SECRET_KEY looks like a placeholder value. Replace it with a real test key from the Stripe dashboard.",
      "placeholder_credential"
    );
  }
  if (!credentialIsStripeKey(kind)) {
    throw new StripeConfigError(
      "STRIPE_SECRET_KEY is not a Stripe API key. Use an sk_test_ or rk_test_ key from the Stripe dashboard.",
      "unsupported_credential"
    );
  }
  return new Stripe(raw.trim(), {
    maxNetworkRetries: 2,
    appInfo: { name: "FunnelRoo", version: "1.0" },
  });
}

// Phase guard: this rollout is TEST-ONLY. Both live key forms (sk_live_, rk_live_)
// are rejected so no live charges, products, or destinations can be created.
// The guard is intentionally not relaxed to make a configuration pass.
export function assertTestMode(): "test" {
  const kind = classifyCredential(stripeKey());
  if (credentialIsLive(kind)) {
    throw new StripeConfigError(
      "Live Stripe keys are not permitted in this phase. Configure a test-mode key (sk_test_ or rk_test_).",
      "live_key_rejected"
    );
  }
  if (!credentialIsTest(kind)) {
    throw new StripeConfigError(
      "Stripe test-mode key not configured.",
      "test_key_missing"
    );
  }
  return "test";
}

// The permissions this integration actually exercises, derived from the calls
// made in this codebase. A restricted key must grant at least these.
export const REQUIRED_STRIPE_PERMISSIONS = [
  "Customers: write",
  "Checkout Sessions: write",
  "Subscriptions: read",
  "Prices: read",
  "Products: read",
  "Products: write",
  "Events: read",
  "Billing Portal Sessions: write",
];

export type VerifyOutcome =
  | "missing_credential"
  | "placeholder_credential"
  | "unsupported_credential"
  | "live_key_rejected"
  | "rejected_credential"
  | "missing_permission"
  | "valid_test"
  | "valid_live";

export interface VerifyResult {
  outcome: VerifyOutcome;
  credential_kind: CredentialKind;
  environment: "test" | "live" | "unknown";
  account_id: string | null;
  account_country: string | null;
  api_version: string;
  webhook_signing_configured: boolean;
  missing_permission: string | null;
  detail: string;
  required_permissions: string[];
}

// Authenticated, NON-MUTATING access check. Uses accounts.retrieve — a read of
// the credential's own account — which requires only a read scope and creates,
// modifies, and deletes nothing. A restricted key lacking a needed permission
// surfaces as a 403 on the specific call, which is classified rather than
// treated as an invalid key. The key value is never returned.
export async function verifyStripeCredential(): Promise<VerifyResult> {
  const kind = classifyCredential(stripeKey());
  const base: VerifyResult = {
    outcome: "missing_credential",
    credential_kind: kind,
    environment: stripeEnvironment(),
    account_id: null,
    account_country: null,
    api_version: stripeRequestApiVersion(),
    webhook_signing_configured: isWebhookSigningConfigured(),
    missing_permission: null,
    detail: "",
    required_permissions: REQUIRED_STRIPE_PERMISSIONS,
  };

  if (kind === "missing") {
    return { ...base, detail: "No STRIPE_SECRET_KEY is set." };
  }
  if (kind === "placeholder") {
    return { ...base, outcome: "placeholder_credential", detail: "The stored key is a placeholder, not a real Stripe key." };
  }
  if (!credentialIsStripeKey(kind)) {
    return { ...base, outcome: "unsupported_credential", detail: "The stored value is not an sk_/rk_ Stripe API key." };
  }
  if (credentialIsLive(kind)) {
    // Deliberately verified as rejected: this rollout must not use a live key.
    return { ...base, outcome: "live_key_rejected", detail: "A live key is configured; this rollout is test-only." };
  }

  const stripe = getStripeClient();
  try {
    const account = (await stripe.accounts.retrieve()) as unknown as {
      id?: string;
      country?: string;
    };
    return {
      ...base,
      outcome: "valid_test",
      account_id: account?.id || null,
      account_country: account?.country || null,
      detail: "Test-mode credential accepted by Stripe (read-only check).",
    };
  } catch (e) {
    const status = Number((e as { statusCode?: number; status?: number })?.statusCode || (e as { status?: number })?.status || 0);
    const message = String((e as { message?: string })?.message || e);
    if (status === 401) {
      return { ...base, outcome: "rejected_credential", detail: "Stripe rejected the credential (401). It may be revoked, expired, or mistyped." };
    }
    if (status === 403) {
      // Restricted key that cannot read the account — the key is valid but this
      // permission is absent. Report the specific permission, do not call it invalid.
      return {
        ...base,
        outcome: "missing_permission",
        missing_permission: "Account: read",
        detail: "The key was accepted but lacks a permission this check needs (Account: read). Grant it, or rely on the per-call checks below.",
      };
    }
    return { ...base, outcome: "rejected_credential", detail: `Stripe verification failed: ${message.slice(0, 200)}` };
  }
}