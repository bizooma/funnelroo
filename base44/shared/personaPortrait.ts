// Shared helpers for Roo-generated persona portraits.
// Builds a sanitized image-generation prompt from an audience's IDENTITY facts
// only (role, industry, company size, location, buying role) — never its pain
// points, objections, quotations or strategy notes — and validates the URL the
// image provider returns. Audience text is treated as data, never as
// instructions that override the art-direction rules below.

import { firstRecord, asArray, audienceContentHash } from "./auth.ts";
import type { Row, ServiceRoleClient } from "./models.ts";
import {
  beginMeteredAction,
  completeMeteredAction,
  abortMeteredAction,
  limitBody,
  httpStatusForLimit,
} from "./enforce.ts";

const ALLOWED_HOSTS = ["media.base44.com", "static.wixstatic.com"];

// Visual preferences are creative choices, separate from factual audience
// attributes. They are stored on the request record, not on the audience.
export function sanitizePreferences(input: any) {
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

function clean(s: any, max: any = 160) {
  return String(s || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Only "who they are" facts are used for the portrait. Problems, objections,
// desired outcomes and quotations are deliberately excluded so the provider
// never receives sensitive strategy text or customer quotes.
export function sanitizeRoleContext(audience: any) {
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

function inferSetting(rolesIndustries: any) {
  const r = (rolesIndustries || "").toLowerCase();
  if (/agency|creative|design|marketing|studio/.test(r)) return "an ordinary creative workspace";
  if (/consult|advisor|coach|consultant/.test(r)) return "a meeting space";
  if (/law|legal|attorney/.test(r)) return "a professional office";
  if (/clinic|health|medical|therap|dental/.test(r)) return "a calm professional practice setting";
  if (/retail|shop|store|restaurant|hospitality|cafe/.test(r)) return "an appropriate small-business setting";
  if (/tech|software|developer|engineer|saas|it /.test(r)) return "a simple modern workspace";
  return "an appropriate work environment";
}

function clothingFor(rolesIndustries: any) {
  const r = (rolesIndustries || "").toLowerCase();
  if (/law|legal|finance|bank|attorney|account/.test(r)) return "smart-casual professional attire";
  return "appropriate, comfortable work attire — not necessarily a formal suit";
}

const STYLE_TERMS: Record<string, string> = {
  photo: "a natural, professional editorial photograph",
  illustration: "a clean, modern editorial illustration",
};

const BACKGROUND_TERMS: Record<string, string> = {
  studio: "a simple, neutral studio background",
  neutral: "a plain, neutral background",
};

// Maintained prompt template. Sanitized context is interpolated; the raw
// audience record is never interpolated. Defaults to a realistic editorial
// photo of one fictional adult, with appearance left unspecified unless the
// user supplied explicit visual preferences.
export function buildPortraitPrompt(audience: any, preferences: any) {
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
export function isValidGeneratedUrl(url: any) {
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
export function publicRequestView(r: any) {
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

// ---------------------------------------------------------------------------
// Generation orchestration — ONE path shared by the customer action and tests.
// ---------------------------------------------------------------------------

const STALE_PENDING_MS = 3 * 60 * 1000;

export interface ImageProvider {
  generate(prompt: string): Promise<{ url?: string }>;
}

/** Mock image provider for tests. Every call returns a UNIQUE url, so two
 *  operations returning the SAME url is evidence that no second generation ran. */
export function createMockImageProvider(): ImageProvider & { calls: number } {
  const provider = {
    calls: 0,
    async generate(): Promise<{ url: string }> {
      provider.calls += 1;
      return { url: `https://media.base44.com/images/test/portrait_${crypto.randomUUID()}.png` };
    },
  };
  return provider;
}

export interface PortraitAudience extends Row {
  id: string;
  workspace_id: string;
  persona?: Row;
}

export interface VisualPreferences {
  style: string;
  background: string;
  appearance: string;
}

export interface PortraitDeps {
  sr: ServiceRoleClient;
  workspaceId: string;
  audience: PortraitAudience;
  prefs: VisualPreferences;
  userId: string;
  /** Caller's logical operation identity. Required for retry-safe recovery. */
  requestId?: string;
  /** Override the provider (tests). Defaults to the Core GenerateImage integration. */
  provider?: ImageProvider;
}

export interface PortraitOutcome {
  ok: boolean;
  status: number;
  request?: Record<string, unknown>;
  audience_revision?: string;
  error?: string;
  limit?: Record<string, unknown>;
  generated?: boolean;
}

/**
 * Generate (or recover) an illustrative portrait for an audience.
 *
 * Order of operations matters: capacity is reserved BEFORE the provider is
 * called, and the reservation is tied to the caller's logical operation id. A
 * retry with the same id recovers the recorded request (and therefore its
 * image) without calling the provider again or consuming another unit.
 */
export async function generateAudiencePortrait(deps: PortraitDeps): Promise<PortraitOutcome> {
  const sr = deps.sr;
  const provider: ImageProvider =
    deps.provider || { generate: (prompt) => sr.integrations.Core.GenerateImage({ prompt }) };
  const revision = audienceContentHash(deps.audience);
  const operationKey = deps.requestId ? `generatePersonaPortrait:${deps.requestId}` : undefined;

  let decision;
  try {
    decision = await beginMeteredAction(sr, {
      workspaceId: deps.workspaceId,
      action: "generatePersonaPortrait",
      metric: "image",
      operationKey,
      payload: { audience_id: deps.audience.id, visual_preferences: deps.prefs },
    });
  } catch (e) {
    return { ok: false, status: 500, error: String((e as { message?: string })?.message || e) };
  }
  if (!decision.allowed) {
    return { ok: false, status: httpStatusForLimit(decision.report!), limit: limitBody(decision.report!) };
  }

  const existing = await findExistingRequest(sr, deps);
  if (existing) {
    // Recovered: same tracked request, same image, no provider call, no new unit.
    return {
      ok: true,
      status: 200,
      request: publicRequestView(existing),
      audience_revision: revision,
      generated: false,
    };
  }

  const prompt = buildPortraitPrompt(deps.audience, deps.prefs);
  let request = await sr.entities.PersonaPortraitRequest.create({
    workspace_id: deps.workspaceId,
    audience_id: deps.audience.id,
    request_id: deps.requestId || crypto.randomUUID(),
    user_id: deps.userId,
    source_audience_revision: revision,
    visual_preferences: deps.prefs,
    state: "pending",
    prompt,
  });
  try {
    const result = await provider.generate(prompt);
    const url = result?.url;
    if (!isValidGeneratedUrl(url)) throw new Error("Image provider returned an unusable result");
    request = await sr.entities.PersonaPortraitRequest.update(request.id, {
      state: "ready",
      candidate_url: url,
    });
    await completeMeteredAction(sr, decision, deps.workspaceId);
    return {
      ok: true,
      status: 200,
      request: publicRequestView(request),
      audience_revision: revision,
      generated: true,
    };
  } catch (e) {
    await sr.entities.PersonaPortraitRequest.update(request.id, {
      state: "failed",
      error: String((e as { message?: string })?.message || e).slice(0, 300),
    });
    await abortMeteredAction(sr, decision, deps.workspaceId);
    return { ok: false, status: 502, error: "Portrait generation failed. Your current image was kept." };
  }
}

// A request is "recoverable" when it belongs to the same logical operation
// (caller-supplied request id) and is still pending or already ready. Otherwise
// an in-flight request for the same audience is reused, as before.
async function findExistingRequest(
  sr: ServiceRoleClient,
  deps: PortraitDeps
): Promise<Row | undefined> {
  if (deps.requestId) {
    const byId = firstRecord<Row>(
      (await sr.entities.PersonaPortraitRequest.filter({
        workspace_id: deps.workspaceId,
        audience_id: deps.audience.id,
        request_id: deps.requestId,
      })) as Row[]
    );
    if (byId && (byId.state === "pending" || byId.state === "ready")) return byId;
  }
  const pending = asArray<Row>(
    (await sr.entities.PersonaPortraitRequest.filter(
      { audience_id: deps.audience.id, state: "pending" },
      { sort: "-created_date", limit: 1 }
    )) as Row[]
  );
  if (!pending[0]) return undefined;
  if (Date.now() - new Date(pending[0].created_date).getTime() > STALE_PENDING_MS) {
    await sr.entities.PersonaPortraitRequest.update(pending[0].id, {
      state: "failed",
      error: "Timed out",
    });
    return undefined;
  }
  return pending[0];
}