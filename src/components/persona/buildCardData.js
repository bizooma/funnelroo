// Builds the display model the PersonaCard renders, from an Audience record
// (canonical source of core facts) + its persona presentation metadata +
// the workspace business profile (for header branding).
export function buildCardData(audience, profile) {
  const p = audience?.persona || {};
  const facts = [];
  if (p.role) facts.push({ label: "Role", value: p.role });
  if (audience?.roles_industries && !p.role) facts.push({ label: "Who", value: audience.roles_industries });
  if (p.industry) facts.push({ label: "Industry", value: p.industry });
  if (p.company_size) facts.push({ label: "Company size", value: p.company_size });
  if (p.location) facts.push({ label: "Location", value: p.location });
  if (p.buying_role) facts.push({ label: "Buying role", value: p.buying_role });
  if (p.age) facts.push({ label: "Age", value: p.age });
  if (p.family) facts.push({ label: "Family", value: p.family });

  const initials = (audience?.name || "A")
    .split(" ").map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();

  const reviewLabel = audience?.status === "ready" ? "Reviewed" : "Draft";

  return {
    title: p.title || audience?.name || "Audience archetype",
    subtitle: p.subtitle,
    facts,
    portrait: { url: p.portrait_url, credit: p.portrait_credit },
    quote: { text: p.quote_text, source: p.quote_source, kind: p.quote_kind },
    motivations: p.motivations || [],
    buyingStyle: p.buying_style || [],
    bio: p.bio_summary,
    goals: audience?.desired_outcomes || [],
    frustrations: audience?.problems || [],
    objections: audience?.objections || [],
    alternatives: audience?.alternatives || [],
    initials,
    meta: {
      name: audience?.name,
      rolesIndustries: audience?.roles_industries,
      businessName: profile?.business_name,
      logoUrl: profile?.logo_url,
      accent_color: profile?.accent_color,
      theme: p.theme,
      highlightsOnly: p.highlights_only,
      stale: p.stale,
      revision: p.source_revision || p.content_hash,
      updatedAt: p.updated_at ? new Date(p.updated_at).toLocaleDateString() : "—",
      reviewLabel,
    },
  };
}

export const THEME_PRESETS = [
  { id: "amber", label: "Classic Amber", accent: "#FFB800" },
  { id: "indigo", label: "Indigo", accent: "#4F46E5" },
  { id: "emerald", label: "Emerald", accent: "#059669" },
  { id: "rose", label: "Rose", accent: "#E11D48" },
  { id: "slate", label: "Slate", accent: "#334155" },
];