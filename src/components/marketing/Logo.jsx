import { LOGO_URL } from "./constants";

// FunnelRoo brand lockup. The logo image itself carries the icon, the
// "FunnelRoo" wordmark, and the "Smart Sales Funnels" tagline, so we render
// the image alone (no separate text).
export function Logo({ className = "" }) {
  return (
    <img
      src={LOGO_URL}
      alt="FunnelRoo — Smart Sales Funnels"
      className={`h-9 w-auto object-contain ${className}`}
    />
  );
}