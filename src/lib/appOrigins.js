// Customer-facing origin helpers (client side).
//
// The canonical site mirrors the server's PUBLIC_APP_ORIGIN configuration. The
// server is authoritative: it re-validates whatever origin is sent, and never
// builds a return URL from a browser value alone.

export const CANONICAL_ORIGIN = "https://funnelroo.com";

const PRODUCTION_ALIASES = [
  "https://funnel-roo-flow.base44.app",
  "https://www.funnelroo.com",
];

const BILLING_RETURN_PATH = "/billing/return";

export function isProductionAlias(origin = window.location.origin) {
  return PRODUCTION_ALIASES.includes(origin);
}

// Origin handed to the backend when starting Checkout or the Customer Portal.
// Aliases normalize to the canonical site so the customer is never returned to
// a backend host.
export function checkoutOrigin() {
  const origin = window.location.origin;
  return isProductionAlias(origin) ? CANONICAL_ORIGIN : origin;
}

// Already-issued return links point at a backend host (or www), where the
// canonical site's session cookie does not exist. Hand them to the canonical
// billing-return route, carrying only a validated Checkout Session id.
export function legacyReturnRedirect() {
  if (window.location.pathname !== BILLING_RETURN_PATH) return null;
  if (!isProductionAlias()) return null;
  const raw = new URLSearchParams(window.location.search).get("session_id") || "";
  const sessionId = /^cs_[A-Za-z0-9_]+$/.test(raw) ? raw : "";
  return sessionId
    ? `${CANONICAL_ORIGIN}${BILLING_RETURN_PATH}?session_id=${encodeURIComponent(sessionId)}`
    : `${CANONICAL_ORIGIN}${BILLING_RETURN_PATH}`;
}