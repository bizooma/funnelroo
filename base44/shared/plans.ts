// Versioned, server-controlled plan catalog — the single source of truth for
// all commercial terms. A customer's agreement pins the catalog_version at
// their time of purchase (stored on WorkspaceBilling); later edits here must
// NOT silently rewrite an active subscription's terms.
//
// Only the two approved plans (Starter, Growth) are purchasable. Agency,
// white labeling, resale, lifetime, per-booking, commissions, and paid seats
// are intentionally absent.

export const CATALOG_VERSION = "2026-10-18.v1";
export const CURRENCY = "usd";

export type PlanId = "starter" | "growth";
export type BillingInterval = "monthly" | "annual";

export interface PlanPrice {
  amount: number;
  interval: "month" | "year";
  display: string;
}

export interface PlanAllowances {
  live_funnels: number;
  team_users: number;
  contacts: number;
  email_sends_per_month: number;
  ai_text_actions_per_month: number;
  images_per_month: number;
}

export interface TrialAllowances {
  live_funnels: number;
  team_users: number;
  contacts: number;
  email_sends_total: number;
  ai_text_actions_total: number;
  images_total: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  highlight?: string;
  prices: { monthly: PlanPrice; annual: PlanPrice };
  /** $/mo equivalent shown secondarily for annual billing. */
  annualMonthlyEquivalentCents: number;
  allowances: PlanAllowances;
}

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: "starter",
    name: "Starter",
    tagline: "Launch your first focused funnels.",
    prices: {
      monthly: { amount: 4900, interval: "month", display: "$49/mo" },
      annual: { amount: 49000, interval: "year", display: "$490/yr" },
    },
    annualMonthlyEquivalentCents: 4083,
    allowances: {
      live_funnels: 3,
      team_users: 2,
      contacts: 2500,
      email_sends_per_month: 5000,
      ai_text_actions_per_month: 100,
      images_per_month: 10,
    },
  },
  growth: {
    id: "growth",
    name: "Growth",
    tagline: "Run more campaigns and follow up with more leads.",
    highlight: "For growing businesses",
    prices: {
      monthly: { amount: 9900, interval: "month", display: "$99/mo" },
      annual: { amount: 99000, interval: "year", display: "$990/yr" },
    },
    annualMonthlyEquivalentCents: 8250,
    allowances: {
      live_funnels: 10,
      team_users: 5,
      contacts: 10000,
      email_sends_per_month: 25000,
      ai_text_actions_per_month: 400,
      images_per_month: 30,
    },
  },
};

// Application-managed trial. Totals for the 14 days, NOT monthly allowances.
export const TRIAL: { duration_days: number; allowances: TrialAllowances } = {
  duration_days: 14,
  allowances: {
    live_funnels: 1,
    team_users: 2,
    contacts: 100,
    email_sends_total: 100,
    ai_text_actions_total: 20,
    images_total: 3,
  },
};

export const CORE_FEATURES: string[] = [
  "Guided setup with Roo",
  "Reusable audiences and offers",
  "Persona cards and exports",
  "Funnel page building",
  "Lead capture and resource delivery",
  "Consent-based nurture sequences",
  "Calendly booking integration",
  "Results reporting",
];

export interface UsageDefinition {
  key: string;
  label: string;
  description: string;
}

export const USAGE_DEFINITIONS: UsageDefinition[] = [
  { key: "live_funnels", label: "Live funnels", description: "Active published funnels. Drafts and paused funnels don't count." },
  { key: "team_users", label: "Team users", description: "Active members including the owner, plus unexpired pending invitations." },
  { key: "contacts", label: "Stored contacts", description: "Distinct contact records per workspace, including archived. Repeat submissions reuse capacity." },
  { key: "email_sends", label: "Email sends", description: "Lead-facing emails accepted by the provider. A technical retry is not another charge." },
  { key: "ai_text_actions", label: "AI text actions", description: "Explicitly requested Roo results — audience, persona, copy, or sequence drafts. Regenerating is a new action; viewing/applying/saving/exporting is not." },
  { key: "images", label: "Generated images", description: "Images generated and saved. Downloading or reusing is not a second unit." },
];

export interface CatalogFaq {
  q: string;
  a: string;
}

export const FAQS: CatalogFaq[] = [
  { q: "Does one subscription cover all my workspaces?", a: "No. Each workspace has its own subscription and usage. If you belong to multiple workspaces, each is billed separately." },
  { q: "How does annual billing work?", a: "You're charged the annual amount once per year — $490 for Starter or $990 for Growth. That saves about two monthly payments, roughly 16.7%. We don't charge the monthly equivalent every month." },
  { q: "What are the trial limits?", a: "The 14-day trial includes 1 live funnel, 2 team users, 100 contacts, 100 email sends, 20 AI text actions, and 3 generated images — totals for the 14 days. Selecting Growth on the pricing page doesn't raise the trial quota." },
  { q: "What consumes AI actions?", a: "Explicitly requesting a new Roo result — an audience draft, persona refinement, page copy, or sequence draft. Regenerating is a new action. Viewing, applying, saving, or exporting existing output is not. Manual editing never consumes AI allowance." },
  { q: "When does usage reset?", a: "Paid email, AI text, and image allowances reset monthly on your subscription anniversary (UTC). Annual billing doesn't grant a year of credits upfront." },
  { q: "Can I cancel anytime?", a: "Yes. Cancellation takes effect at the end of your paid term, and your plan stays available until then. No automatic refunds in this phase." },
  { q: "Do I need a separate scheduling account?", a: "Yes. Booking runs through your own Calendly account, whose plan requirements are separate from your FunnelRoo plan. A FunnelRoo upgrade doesn't change your Calendly plan." },
];

export function getPlan(id: string): Plan | null {
  return PLANS[id as PlanId] || null;
}

export function getPrice(planId: string, interval: BillingInterval): PlanPrice | null {
  const plan = getPlan(planId);
  if (!plan) return null;
  return interval === "annual" ? plan.prices.annual : plan.prices.monthly;
}

export interface PublicCatalog {
  catalog_version: string;
  currency: string;
  plans: Array<{
    id: PlanId;
    name: string;
    tagline: string;
    highlight: string | null;
    prices: {
      monthly: { amount: number; interval: string; display: string };
      annual: { amount: number; interval: string; display: string; monthly_equivalent_cents: number };
    };
    allowances: PlanAllowances;
  }>;
  trial: { duration_days: number; allowances: TrialAllowances };
  core_features: string[];
  usage_definitions: UsageDefinition[];
  faqs: CatalogFaq[];
}

// Public catalog projection for the pricing page. Contains no internal secrets
// or Stripe identifiers — only the terms a visitor needs to choose a plan.
export function publicCatalog(): PublicCatalog {
  return {
    catalog_version: CATALOG_VERSION,
    currency: CURRENCY,
    plans: Object.values(PLANS).map((p) => ({
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      highlight: p.highlight || null,
      prices: {
        monthly: { amount: p.prices.monthly.amount, interval: "month", display: p.prices.monthly.display },
        annual: {
          amount: p.prices.annual.amount,
          interval: "year",
          display: p.prices.annual.display,
          monthly_equivalent_cents: p.annualMonthlyEquivalentCents,
        },
      },
      allowances: p.allowances,
    })),
    trial: { duration_days: TRIAL.duration_days, allowances: TRIAL.allowances },
    core_features: CORE_FEATURES,
    usage_definitions: USAGE_DEFINITIONS,
    faqs: FAQS,
  };
}