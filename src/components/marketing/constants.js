// Approved FunnelRoo brand logo (sourced from the app's published brand theme).
export const LOGO_URL = "https://media.base44.com/images/public/6acba9de240facdd95f5665d/1351a4f9c_funnelroologo.png";

// Same-page section anchors used by the header navigation.
export const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Templates", href: "#templates" },
  { label: "Pricing", href: "/pricing" },
  { label: "FAQ", href: "#faq" },
];

// Auth entry destination — the authenticated app entry that routes to
// onboarding (no workspace) or the workspace dashboard.
export const APP_ENTRY = "/app";
export const REGISTER_URL = `/register?returnTo=${encodeURIComponent(APP_ENTRY)}`;
export const LOGIN_URL = `/login?returnTo=${encodeURIComponent(APP_ENTRY)}`;