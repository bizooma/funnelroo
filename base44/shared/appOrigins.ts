// Customer-facing origins for FunnelRoo.
//
// One canonical site (PUBLIC_APP_ORIGIN, e.g. https://funnelroo.com) is the only
// origin customers are ever returned to. Backend function and webhook hosts are
// NOT customer destinations, so they are never used to build a return URL.
//
// Fail-safe direction: an unknown, missing, arbitrary, or Host-header-supplied
// origin resolves to the canonical site — never to a backend host.

const CANONICAL_ORIGIN_FALLBACK = "https://funnelroo.com";

// Customer-facing aliases of the same site. Used ONLY to normalize an incoming
// alias to the canonical origin; never used to build a URL.
const PRODUCTION_ALIASES = [
  "https://funnel-roo-flow.base44.app",
  "https://www.funnelroo.com",
];

const BILLING_RETURN_PATH = "/billing/return";
const BILLING_SETTINGS_PATH = "/settings?tab=billing";

/** A bare https origin only: no path, query, fragment, or non-https scheme. */
function parseOrigin(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function canonicalOrigin(): string {
  return parseOrigin(process.env.PUBLIC_APP_ORIGIN) || CANONICAL_ORIGIN_FALLBACK;
}

// Explicitly configured non-production origins (editor preview / local dev),
// comma-separated and isolated from production: honored only when listed.
export function previewOrigins(): string[] {
  return String(process.env.PUBLIC_APP_PREVIEW_ORIGINS || "")
    .split(",")
    .map((entry) => parseOrigin(entry))
    .filter((origin): origin is string => !!origin);
}

/**
 * Resolve the origin a customer should be returned to. A requested origin is
 * honored only when it is a known customer-facing alias (normalized to the
 * canonical site) or an explicitly configured preview origin.
 */
export function customerOrigin(requested?: unknown): string {
  const canonical = canonicalOrigin();
  const parsed = parseOrigin(requested);
  if (!parsed) return canonical;
  if (parsed === canonical || PRODUCTION_ALIASES.includes(parsed)) return canonical;
  if (previewOrigins().includes(parsed)) return parsed;
  return canonical;
}

/** Stripe success page: the canonical billing-return route. */
export function billingReturnUrl(origin?: string): string {
  return `${customerOrigin(origin)}${BILLING_RETURN_PATH}?session_id={CHECKOUT_SESSION_ID}`;
}

/** Stripe cancel page and Customer Portal return: the canonical billing screen. */
export function billingSettingsUrl(origin?: string): string {
  return `${customerOrigin(origin)}${BILLING_SETTINGS_PATH}`;
}