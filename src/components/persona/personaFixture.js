// Fictional fixture rendered by the real PersonaCard, so the export layout
// can be verified without touching any live audience. Not customer data.
const portraitSvg =
  "<svg xmlns='http://www.w3.org/2000/svg' width='440' height='330'>" +
  "<rect width='440' height='330' fill='#0f766e'/>" +
  "<circle cx='220' cy='128' r='64' fill='#d1fae5'/>" +
  "<rect x='152' y='200' width='136' height='130' rx='22' fill='#d1fae5'/>" +
  "</svg>";
const portraitUrl = "data:image/svg+xml;utf8," + encodeURIComponent(portraitSvg);

export const personaFixture = {
  title: "Law Firm Managing Partner / Marketing Director",
  subtitle: "Mid-sized professional services · 25–80 staff",
  facts: [
    { label: "Role", value: "Managing Partner" },
    { label: "Industry", value: "Legal services" },
    { label: "Company size", value: "25–80 staff" },
    { label: "Location", value: "Regional metro" },
    { label: "Buying role", value: "Economic buyer" },
  ],
  portrait: {
    url: portraitUrl,
    origin: "ai",
    credit: "",
    alt: "AI-generated illustrative portrait of this audience — not a real customer",
  },
  quote: {
    text: "We need a steady pipeline of qualified matters, not more generic leads.",
    source: "Illustrative",
    kind: "illustrative",
  },
  motivations: [
    { label: "Predictable pipeline", rating: 4 },
    { label: "Firm reputation", rating: 5 },
    { label: "Partner buy-in", rating: 3 },
  ],
  buyingStyle: [],
  messagingGuidance: [
    { heading: "Lead with outcomes", text: "Frame the offer around qualified consultations, not raw lead counts." },
    { heading: "Address risk", text: "Show how intake quality is vetted before partner time is spent." },
    { heading: "Show proof", text: "Reference comparable firms without naming clients." },
  ],
  bio: "Manages practice growth alongside firm operations. Balances partner expectations with limited marketing staff and tight budgets. Cares about reputation and predictable, qualified intake.",
  goals: [
    "Steady flow of qualified matters",
    "Clear ROI on marketing spend",
    "Less partner time on intake",
  ],
  frustrations: [
    "Generic leads that waste partner time",
    "Inconsistent intake quality",
    "Hard to attribute results",
  ],
  objections: ["We already have referrals", "Marketing firms overpromise", "Unclear ROI"],
  alternatives: ["Referral networks", "Generalist agencies", "In-house coordinator"],
  initials: "LM",
  meta: {
    name: "Law Firm Managing Partner / Marketing Director",
    rolesIndustries: "Legal services",
    businessName: "FunnelRoo Demo Co.",
    logoUrl: null,
    accent_color: "#059669",
    theme: { accent: "#059669", preset: "emerald" },
    highlightsOnly: false,
    stale: false,
    reviewedRevision: "rev12345678",
    messagingAiSuggested: true,
    revision: "rev12345678",
    updatedAt: "10/18/2026",
    reviewLabel: "Reviewed",
  },
};