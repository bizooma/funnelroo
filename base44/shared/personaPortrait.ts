// Shared helpers for Roo-generated persona portraits.
// Builds a sanitized image-generation prompt from an audience's IDENTITY facts
// only (role, industry, company size, location, buying role) — never its pain
// points, objections, quotations or strategy notes — and validates the URL the
// image provider returns. Audience text is treated as data, never as
// instructions that override the art-direction rules below.

const ALLOWED_HOSTS = ["media.base44.com", "static.wixstatic.com"];

// Visual preferences are creative choices, separate from factual audience
// attributes. They are stored on the request record, not on the audience.
export function sanitizePreferences(input) {
  const p = input || {};
  const style = p.style === "illustration" ? "illustration" : "photo";
  const background = ["workplace", "studio", "neutral"].includes(p.background)
    ? p.background
    : "workplace";
  let appearance = "";
  if (typeof p.appearance === "string") {
    appearance = p.appearance
      .slice(0, 200)
      .replace(/[<>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return { style, background, appearance };
}

function clean(s, max = 160) {
  return String(s || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Only "who they are" facts are used for the portrait. Problems, objections,
// desired outcomes and quotations are deliberately excluded so the provider
// never receives sensitive strategy text or customer quotes.
export function sanitizeRoleContext(audience) {
  const persona = audience?.persona || {};
  const parts = [];
  const role = clean(persona.role || audience?.roles_industries || "");
  if (role) parts.push(`role: ${role}`);
  const industry = clean(persona.industry);
  if (industry) parts.push(`industry: ${industry}`);
  const companySize = clean(persona.company_size);
  if (companySize) parts.push(`company size: ${companySize}`);
  const location = clean(persona.location);
  if (location) parts.push(`location: ${location}`);
  const buyingRole = clean(persona.buying_role);
  if (buyingRole) parts.push(`buying role: ${buyingRole}`);
  return parts.join("; ") || "a professional buyer persona";
}

function inferSetting(rolesIndustries) {
  const r = (rolesIndustries || "").toLowerCase();
  if (/agency|creative|design|marketing|studio/.test(r)) return "an ordinary creative workspace";
  if (/consult|advisor|coach|consultant/.test(r)) return "a meeting space";
  if (/law|legal|attorney/.test(r)) return "a professional office";
  if (/clinic|health|medical|therap|dental/.test(r)) return "a calm professional practice setting";
  if (/retail|shop|store|restaurant|hospitality|cafe/.test(r)) return "an appropriate small-business setting";
  if (/tech|software|developer|engineer|saas|it /.test(r)) return "a simple modern workspace";
  return "an appropriate work environment";
}

function clothingFor(rolesIndustries) {
  const r = (rolesIndustries || "").toLowerCase();
  if (/law|legal|finance|bank|attorney|account/.test(r)) return "smart-casual professional attire";
  return "appropriate, comfortable work attire — not necessarily a formal suit";
}

const STYLE_TERMS = {
  photo: "a natural, professional editorial photograph",
  illustration: "a clean, modern editorial illustration",
};

const BACKGROUND_TERMS = {
  studio: "a simple, neutral studio background",
  neutral: "a plain, neutral background",
};

// Maintained prompt template. Sanitized context is interpolated; the raw
// audience record is never interpolated. Defaults to a realistic editorial
// photo of one fictional adult, with appearance left unspecified unless the
// user supplied explicit visual preferences.
export function buildPortraitPrompt(audience, preferences) {
  const p = sanitizePreferences(preferences);
  const roleContext = sanitizeRoleContext(audience);
  const setting =
    p.background === "workplace"
      ? inferSetting(audience?.roles_industries)
      : BACKGROUND_TERMS[p.background];
  const styleTerm = STYLE_TERMS[p.style];
  const clothing = clothingFor(audience?.roles_industries);
  const appearanceClause = p.appearance
    ? `Apply only these explicit visual preferences: ${p.appearance}. Do not infer other identity details.`
    : "Leave specific appearance details unspecified; depict a plausible fictional adult without implying any particular demographic default.";
  return [
    `Create ${styleTerm} of one fictional adult representing this audience role and work context: ${roleContext}.`,
    `Setting: ${setting}. Clothing: ${clothing}.`,
    `Composition: head and shoulders to upper torso, sharp focus on the face, generous headroom, and space around the shoulders for cropping.`,
    `Natural lighting, calm and approachable expression.`,
    `This is an illustrative buyer persona — not a real identified person and not a statistical depiction of the audience's demographics.`,
    appearanceClause,
    `No text, captions, logos, watermarks, charts, badges, exaggerated luxury, caricature, or stereotyped distress in the image.`,
  ].join(" ");
}

// Only accept image URLs from platform-managed storage origins. No unrestricted
// URL-fetch proxy is exposed; the provider's own prompt is never returned.
export function isValidGeneratedUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

// Public projection of a request record: the prompt is kept private.
export function publicRequestView(r) {
  return {
    id: r.id,
    request_id: r.request_id,
    state: r.state,
    candidate_url: r.candidate_url,
    source_audience_revision: r.source_audience_revision,
    visual_preferences: r.visual_preferences,
    error: r.error,
    created_date: r.created_date,
  };
}