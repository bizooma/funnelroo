import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import {
  requireMembership,
  firstRecord,
  asArray,
  ok,
  err,
  HttpError,
  audienceContentHash,
} from "../../shared/auth.ts";
import {
  sanitizePreferences,
  buildPortraitPrompt,
  isValidGeneratedUrl,
  publicRequestView,
} from "../../shared/personaPortrait.ts";
import { evaluateReadiness, nextDashboardAction } from "../../shared/readiness.ts";

// Allowlist + light validation for the persona presentation object.
const PERSONA_KEYS = [
  "title", "subtitle", "role", "industry", "company_size", "location",
  "buying_role", "age", "family", "portrait_url", "portrait_credit",
  "portrait_origin", "portrait_alt", "portrait_applied_at",
  "quote_text", "quote_source", "quote_kind", "bio_summary",
  "motivations", "buying_style", "messaging_guidance", "messaging_ai_suggested",
  "theme", "highlights_only",
];
function sanitizePersona(input) {
  if (!input || typeof input !== "object") return undefined;
  const out = {};
  for (const k of PERSONA_KEYS) {
    if (input[k] !== undefined) out[k] = input[k];
  }
  if (out.quote_kind && !["customer", "representative", "illustrative"].includes(out.quote_kind)) {
    delete out.quote_kind;
  }
  if (Array.isArray(out.motivations)) {
    out.motivations = out.motivations.slice(0, 6).map((m) => ({
      label: String(m.label || "").slice(0, 80),
      explanation: String(m.explanation || "").slice(0, 200),
      rating: Number.isFinite(m.rating) && m.rating >= 1 && m.rating <= 5 ? Math.round(m.rating) : null,
    })).filter((m) => m.label);
  }
  if (Array.isArray(out.buying_style)) {
    out.buying_style = out.buying_style.slice(0, 6).map((b) => ({
      pair_label: String(b.pair_label || "").slice(0, 80),
      left: String(b.left || "").slice(0, 60),
      right: String(b.right || "").slice(0, 60),
      position: Number.isFinite(b.position) ? Math.max(0, Math.min(100, Math.round(b.position))) : null,
    })).filter((b) => b.left && b.right);
  }
  if (Array.isArray(out.messaging_guidance)) {
    out.messaging_guidance = out.messaging_guidance.slice(0, 6).map((g) => ({
      heading: String(g.heading || "").slice(0, 40),
      text: String(g.text || "").slice(0, 300),
    })).filter((g) => g.text);
  }
  if (out.messaging_ai_suggested !== undefined) {
    out.messaging_ai_suggested = !!out.messaging_ai_suggested;
  }
  if (out.theme && typeof out.theme === "object") {
    out.theme = { accent: String(out.theme.accent || "").slice(0, 20), preset: String(out.theme.preset || "").slice(0, 40) };
  }
  return out;
}

// Generated content fields reflect the audience's core facts (bio, messaging
// guidance, quote, motivations). A save that changes only presentation (theme,
// portrait, demographics) is cosmetic and must not mark previously generated
// content current or rebind it to the latest audience revision.
const GENERATED_FIELDS = ["bio_summary", "messaging_guidance", "quote_text", "motivations"];
function generatedFieldsChanged(next, prev) {
  for (const k of GENERATED_FIELDS) {
    const a = next[k] === undefined ? null : next[k];
    const b = prev[k] === undefined ? null : prev[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) return true;
  }
  return false;
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const sr = base44.asServiceRole;

    // ---- getDashboardState: next-action + progress for the dashboard ----
    if (action === "getDashboardState") {
      await requireMembership(base44, body.workspace_id);
      const [profile, audiences, offers, funnels, setupSessions] = await Promise.all([
        sr.entities.BusinessProfile.filter({ workspace_id: body.workspace_id }),
        sr.entities.Audience.filter({ workspace_id: body.workspace_id }),
        sr.entities.Offer.filter({ workspace_id: body.workspace_id }),
        sr.entities.Funnel.filter({ workspace_id: body.workspace_id }, { sort: "-created_date" }),
        sr.entities.SetupSession.filter({ workspace_id: body.workspace_id, user_id: (await base44.auth.me()).id, completed: false, abandoned: false }),
      ]);
      const state = {
        profile: firstRecord(profile),
        audiences: asArray(audiences),
        offers: asArray(offers),
        funnels: asArray(funnels),
        setupSessions: asArray(setupSessions),
      };
      return ok(nextDashboardAction(state));
    }

    // ---- listAudiences ----
    if (action === "listAudiences") {
      await requireMembership(base44, body.workspace_id);
      const query = { workspace_id: body.workspace_id };
      if (body.status) query.status = body.status;
      const audiences = asArray(
        await sr.entities.Audience.filter(query, { sort: "-created_date" })
      );
      // Count funnel usage for each audience
      const funnels = asArray(
        await sr.entities.Funnel.filter({ workspace_id: body.workspace_id })
      );
      const usageMap = {};
      for (const f of funnels) {
        if (f.audience_id) usageMap[f.audience_id] = (usageMap[f.audience_id] || 0) + 1;
      }
      return ok({
        audiences: audiences.map((a) => ({ ...a, funnel_count: usageMap[a.id] || 0 })),
      });
    }

    // ---- listOffers ----
    if (action === "listOffers") {
      await requireMembership(base44, body.workspace_id);
      const query = { workspace_id: body.workspace_id };
      if (body.status) query.status = body.status;
      const offers = asArray(
        await sr.entities.Offer.filter(query, { sort: "-created_date" })
      );
      const funnels = asArray(
        await sr.entities.Funnel.filter({ workspace_id: body.workspace_id })
      );
      const usageMap = {};
      for (const f of funnels) {
        if (f.offer_id) usageMap[f.offer_id] = (usageMap[f.offer_id] || 0) + 1;
      }
      return ok({
        offers: offers.map((o) => ({ ...o, funnel_count: usageMap[o.id] || 0 })),
      });
    }

    // ---- saveAudience (create or update) ----
    if (action === "saveAudience") {
      await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const data = {
        roles_industries: body.roles_industries || "",
        problems: body.problems || [],
        desired_outcomes: body.desired_outcomes || [],
        objections: body.objections || [],
        alternatives: body.alternatives || [],
        ai_suggested: body.ai_suggested !== undefined ? body.ai_suggested : false,
      };
      // Status management: "ready" requires review by an authorized user
      if (body.status !== undefined) {
        const status = body.status;
        if (!["draft", "ready", "archived"].includes(status)) {
          return err(400, "Invalid status");
        }
        data.status = status;
        // "ready" maps to approved=true for backward compat with Roo
        data.approved = status === "ready";
        if (status === "ready") {
          const user = await base44.auth.me();
          data.reviewed_by = user.id;
          data.reviewed_at = new Date().toISOString();
        }
      }
      let audience;
      if (body.id) {
        const existing = firstRecord(await sr.entities.Audience.filter({ id: body.id }));
        if (!existing) return err(404, "Audience not found");
        if (existing.workspace_id !== body.workspace_id) {
          return err(403, "Audience not in this workspace");
        }
        // If core facts changed and a persona card exists, flag it stale.
        const merged = { ...existing, ...data, name: body.name };
        const newHash = audienceContentHash(merged);
        const personaUpdate = {};
        if (existing.persona && existing.persona.content_hash && existing.persona.content_hash !== newHash) {
          personaUpdate.persona = { ...existing.persona, stale: true };
        }
        audience = await sr.entities.Audience.update(body.id, { ...data, name: body.name, ...personaUpdate });
      } else {
        audience = await sr.entities.Audience.create({
          workspace_id: body.workspace_id,
          name: body.name,
          status: data.status || "draft",
          approved: data.approved || false,
          ...data,
        });
      }
      return ok({ audience });
    }

    // ---- duplicateAudience: create a draft copy ----
    if (action === "duplicateAudience") {
      await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const existing = firstRecord(
        await sr.entities.Audience.filter({ id: body.id, workspace_id: body.workspace_id })
      );
      if (!existing) return err(404, "Audience not found");
      const copy = await sr.entities.Audience.create({
        workspace_id: body.workspace_id,
        name: `${existing.name} (copy)`,
        roles_industries: existing.roles_industries,
        problems: existing.problems || [],
        desired_outcomes: existing.desired_outcomes || [],
        objections: existing.objections || [],
        alternatives: existing.alternatives || [],
        status: "draft",
        approved: false,
        ai_suggested: false,
        source_id: existing.id,
      });
      return ok({ audience: copy });
    }

    // ---- archiveAudience / restoreAudience ----
    if (action === "archiveAudience" || action === "restoreAudience") {
      await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const existing = firstRecord(
        await sr.entities.Audience.filter({ id: body.id, workspace_id: body.workspace_id })
      );
      if (!existing) return err(404, "Audience not found");
      const newStatus = action === "archiveAudience" ? "archived" : "draft";
      const updated = await sr.entities.Audience.update(body.id, {
        status: newStatus,
        approved: newStatus === "ready",
      });
      return ok({ audience: updated });
    }

    // ---- saveOffer (create or update) ----
    if (action === "saveOffer") {
      await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const data = {
        offer: body.offer || "",
        goal: body.goal,
        cta: body.cta || "",
        benefit: body.benefit || "",
        deliverable: body.deliverable || "",
        pricing: body.pricing || "",
        differentiators: body.differentiators || [],
        exclusions: body.exclusions || [],
        supporting_proof: body.supporting_proof || [],
        ai_suggested: body.ai_suggested !== undefined ? body.ai_suggested : false,
      };
      if (body.status !== undefined) {
        const status = body.status;
        if (!["draft", "ready", "archived"].includes(status)) {
          return err(400, "Invalid status");
        }
        data.status = status;
        data.approved = status === "ready";
        if (status === "ready") {
          const user = await base44.auth.me();
          data.reviewed_by = user.id;
          data.reviewed_at = new Date().toISOString();
        }
      }
      let offer;
      if (body.id) {
        const existing = firstRecord(await sr.entities.Offer.filter({ id: body.id }));
        if (!existing) return err(404, "Offer not found");
        if (existing.workspace_id !== body.workspace_id) {
          return err(403, "Offer not in this workspace");
        }
        offer = await sr.entities.Offer.update(body.id, { ...data, name: body.name });
      } else {
        offer = await sr.entities.Offer.create({
          workspace_id: body.workspace_id,
          name: body.name,
          status: data.status || "draft",
          approved: data.approved || false,
          ...data,
        });
      }
      return ok({ offer });
    }

    // ---- duplicateOffer ----
    if (action === "duplicateOffer") {
      await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const existing = firstRecord(
        await sr.entities.Offer.filter({ id: body.id, workspace_id: body.workspace_id })
      );
      if (!existing) return err(404, "Offer not found");
      const copy = await sr.entities.Offer.create({
        workspace_id: body.workspace_id,
        name: `${existing.name} (copy)`,
        offer: existing.offer,
        goal: existing.goal,
        cta: existing.cta,
        benefit: existing.benefit,
        deliverable: existing.deliverable,
        pricing: existing.pricing,
        differentiators: existing.differentiators || [],
        exclusions: existing.exclusions || [],
        supporting_proof: existing.supporting_proof || [],
        status: "draft",
        approved: false,
        ai_suggested: false,
        source_id: existing.id,
      });
      return ok({ offer: copy });
    }

    // ---- archiveOffer / restoreOffer ----
    if (action === "archiveOffer" || action === "restoreOffer") {
      await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const existing = firstRecord(
        await sr.entities.Offer.filter({ id: body.id, workspace_id: body.workspace_id })
      );
      if (!existing) return err(404, "Offer not found");
      const newStatus = action === "archiveOffer" ? "archived" : "draft";
      const updated = await sr.entities.Offer.update(body.id, {
        status: newStatus,
        approved: newStatus === "ready",
      });
      return ok({ offer: updated });
    }

    // ---- updateBusinessProfile (delegates to briefAccess pattern) ----
    if (action === "updateBusinessProfile") {
      await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const profile = firstRecord(
        await sr.entities.BusinessProfile.filter({ workspace_id: body.workspace_id })
      );
      const allowed = [
        "business_name", "website", "logo_url", "primary_color", "accent_color",
        "brand_voice", "primary_service", "audience_summary", "offer_summary",
        "contact_email", "time_zone", "currency", "approved_facts", "proof_sources",
        "language_to_use", "language_to_avoid", "onboarding_complete",
      ];
      const update = {};
      for (const k of allowed) {
        if (body[k] !== undefined) update[k] = body[k];
      }
      let result;
      if (profile) {
        result = await sr.entities.BusinessProfile.update(profile.id, update);
      } else {
        result = await sr.entities.BusinessProfile.create({
          workspace_id: body.workspace_id,
          ...update,
        });
      }
      return ok({ profile: result });
    }

    // ---- getAudience: single audience + workspace branding for the persona card ----
    if (action === "getAudience") {
      await requireMembership(base44, body.workspace_id);
      const audience = firstRecord(
        await sr.entities.Audience.filter({ id: body.id, workspace_id: body.workspace_id })
      );
      if (!audience) return err(404, "Audience not found");
      const profile = firstRecord(
        await sr.entities.BusinessProfile.filter({ workspace_id: body.workspace_id })
      );
      // Expose the current audience revision so the card page can pass it back
      // as expected_revision when recording an explicit review. This lets the
      // backend validate that the audience didn't change during the review.
      return ok({ audience, profile, audience_revision: audienceContentHash(audience) });
    }

    // ---- savePersonaCard: persist persona presentation edits ----
    // A normal save persists edits but does NOT change review state: it never
    // clears staleness or records a review. Changing one generated field
    // (e.g. bio) must not implicitly approve other unchanged generated
    // sections (messaging guidance, quote, motivations) that still need
    // review after an audience change. Review is a separate explicit action
    // (reviewPersonaCard). Origin (messaging_ai_suggested) is also separate
    // and never implies reviewed.
    if (action === "savePersonaCard") {
      const { user } = await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const existing = firstRecord(
        await sr.entities.Audience.filter({ id: body.id, workspace_id: body.workspace_id })
      );
      if (!existing) return err(404, "Audience not found");
      const sanitized = sanitizePersona(body.persona) || {};
      const newHash = audienceContentHash(existing);
      const prev = existing.persona || {};
      const persona = {
        ...prev,
        ...sanitized,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      };
      if (!prev.content_hash) {
        // First card save: bind to the current revision so future audience
        // changes can be detected. No review is recorded yet.
        persona.content_hash = newHash;
        persona.source_revision = newHash;
        persona.stale = false;
      } else {
        // Preserve the revision the content was last bound to and any existing
        // staleness warning. Edits alone don't re-approve content. If generated
        // content changed after a prior explicit review, that review no longer
        // covers the modified content, so it is invalidated (needs re-review).
        persona.content_hash = prev.content_hash;
        persona.source_revision = prev.source_revision;
        persona.stale = prev.stale ?? false;
        if (generatedFieldsChanged(sanitized, prev) && prev.reviewed_revision) {
          persona.reviewed_revision = null;
          persona.reviewed_at = null;
          persona.reviewed_by = null;
        }
      }
      const updated = await sr.entities.Audience.update(body.id, { persona });
      return ok({ audience: updated });
    }

    // ---- reviewPersonaCard: explicit "Review & mark up to date" ----
    // Covers ALL affected persona content (bio, messaging guidance,
    // quotations, motivations) against the displayed audience revision.
    // Separate from saving and from marking the audience Ready to use; it
    // introduces no new global approval workflow. The revision the user
    // reviewed against is validated server-side: if the audience changed
    // while the review was open, the warning is NOT cleared — the user must
    // reload and review against the newer revision.
    if (action === "reviewPersonaCard") {
      const { user } = await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const existing = firstRecord(
        await sr.entities.Audience.filter({ id: body.id, workspace_id: body.workspace_id })
      );
      if (!existing) return err(404, "Audience not found");
      const currentHash = audienceContentHash(existing);
      const expected = body.expected_revision;
      if (expected && expected !== currentHash) {
        // Audience changed since the user opened the card. Preserve any edits
        // already saved; do not clear the warning. Require a fresh review.
        return ok({ audience: existing, audience_changed: true });
      }
      const prev = existing.persona || {};
      const persona = {
        ...prev,
        content_hash: currentHash,
        source_revision: currentHash,
        reviewed_revision: currentHash,
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
        stale: false,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      };
      const updated = await sr.entities.Audience.update(body.id, { persona });
      return ok({ audience: updated, audience_changed: false });
    }

    // ---- evaluateReadiness: shared template-aware readiness for a funnel ----
    if (action === "evaluateReadiness") {
      const funnelResult = await sr.entities.Funnel.filter({ id: body.funnel_id });
      const funnel = firstRecord(funnelResult);
      if (!funnel) return err(404, "Funnel not found");
      await requireMembership(base44, funnel.workspace_id);
      const draft = firstRecord(
        await sr.entities.FunnelDraft.filter({ funnel_id: funnel.id })
      );
      return ok({ readiness: evaluateReadiness(funnel, draft) });
    }

    // ---- getSetupSession / saveSetupSession ----
    if (action === "getSetupSession") {
      await requireMembership(base44, body.workspace_id);
      const sessions = asArray(
        await sr.entities.SetupSession.filter({
          workspace_id: body.workspace_id,
          user_id: (await base44.auth.me()).id,
          completed: false,
          abandoned: false,
        }, { sort: "-created_date" })
      );
      return ok({ session: sessions[0] || null });
    }

    if (action === "saveSetupSession") {
      const { membership } = await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const user = await base44.auth.me();
      const update = {};
      for (const k of ["step", "mode", "template", "funnel_name", "audience_id", "offer_id", "resource_id", "resource_concept", "funnel_id", "context_snapshot", "completed", "abandoned"]) {
        if (body[k] !== undefined) update[k] = body[k];
      }
      let session;
      if (body.id) {
        const existing = firstRecord(
          await sr.entities.SetupSession.filter({ id: body.id, workspace_id: body.workspace_id, user_id: user.id })
        );
        if (!existing) return err(404, "Setup session not found");
        session = await sr.entities.SetupSession.update(body.id, update);
      } else {
        session = await sr.entities.SetupSession.create({
          workspace_id: body.workspace_id,
          user_id: user.id,
          step: "prepare_business",
          mode: "guided",
          ...update,
        });
      }
      return ok({ session });
    }

    // ---- createFunnelFromSetup: durable retry-safe funnel creation ----
    if (action === "createFunnelFromSetup") {
      const { membership } = await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const user = await base44.auth.me();
      // Idempotency: if session already has a funnel_id, return the existing funnel
      if (body.session_id) {
        const session = firstRecord(
          await sr.entities.SetupSession.filter({ id: body.session_id, workspace_id: body.workspace_id, user_id: user.id })
        );
        if (session?.funnel_id) {
          const existingFunnel = firstRecord(await sr.entities.Funnel.filter({ id: session.funnel_id }));
          if (existingFunnel) return ok({ funnel: existingFunnel, resumed: true });
        }
      }
      const name = String(body.name || "Untitled funnel").trim();
      const type = body.type;
      if (!["lead_magnet", "direct_booking", "service_inquiry"].includes(type)) {
        return err(400, "Invalid funnel type");
      }
      // Create the funnel + draft via funnelAccess
      const createRes = await base44.functions.invoke("funnelAccess", {
        action: "create",
        workspace_id: body.workspace_id,
        name,
        type,
        audience_id: body.audience_id || "",
        offer_id: body.offer_id || "",
      });
      const funnel = createRes.data?.funnel;
      if (!funnel) return err(500, "Funnel creation failed");
      // Save context snapshot to the draft
      if (body.context_snapshot) {
        const draft = firstRecord(await sr.entities.FunnelDraft.filter({ funnel_id: funnel.id }));
        if (draft) {
          await sr.entities.FunnelDraft.update(draft.id, {
            context_snapshot: { ...body.context_snapshot, captured_at: new Date().toISOString() },
            setup_step: "launch",
          });
        }
      }
      // Mark the setup session as completed
      if (body.session_id) {
        await sr.entities.SetupSession.update(body.session_id, {
          funnel_id: funnel.id,
          step: "completed",
          completed: true,
        });
      }
      return ok({ funnel, resumed: false });
    }

    // ---- Persona portrait generation (Roo) ----
    // Generates an illustrative portrait from the audience's identity facts
    // only. One in-flight request per audience: repeated clicks or a reconnect
    // recover the same tracked request instead of launching another job. The
    // candidate is never applied without an explicit "Use this image", and the
    // current portrait is preserved if generation fails or is dismissed.
    // Portrait changes are presentation-only: they do not mark the audience
    // Ready, clear a content-staleness warning, or affect text review.
    if (action === "generatePersonaPortrait") {
      const { user } = await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const audience = firstRecord(
        await sr.entities.Audience.filter({ id: body.id, workspace_id: body.workspace_id })
      );
      if (!audience) return err(404, "Audience not found");
      const revision = audienceContentHash(audience);
      const prefs = sanitizePreferences(body.visual_preferences);
      const STALE_PENDING_MS = 3 * 60 * 1000;
      // Recover an in-flight request instead of launching a duplicate job.
      const pending = asArray(
        await sr.entities.PersonaPortraitRequest.filter(
          { audience_id: body.id, state: "pending" },
          { sort: "-created_date", limit: 1 }
        )
      );
      if (pending[0]) {
        if (Date.now() - new Date(pending[0].created_date).getTime() > STALE_PENDING_MS) {
          await sr.entities.PersonaPortraitRequest.update(pending[0].id, { state: "failed", error: "Timed out" });
        } else {
          return ok({ request: publicRequestView(pending[0]), audience_revision: revision });
        }
      }
      const requestId = crypto.randomUUID();
      const prompt = buildPortraitPrompt(audience, prefs);
      let request = await sr.entities.PersonaPortraitRequest.create({
        workspace_id: body.workspace_id,
        audience_id: body.id,
        request_id: requestId,
        user_id: user.id,
        source_audience_revision: revision,
        visual_preferences: prefs,
        state: "pending",
        prompt,
      });
      try {
        const result = await sr.integrations.Core.GenerateImage({ prompt });
        const url = result?.url;
        if (!isValidGeneratedUrl(url)) throw new Error("Image provider returned an unusable result");
        request = await sr.entities.PersonaPortraitRequest.update(request.id, {
          state: "ready",
          candidate_url: url,
        });
        return ok({ request: publicRequestView(request), audience_revision: revision });
      } catch (e) {
        await sr.entities.PersonaPortraitRequest.update(request.id, {
          state: "failed",
          error: String(e.message || e).slice(0, 300),
        });
        return err(502, "Portrait generation failed. Your current image was kept.");
      }
    }

    if (action === "getPersonaPortrait") {
      await requireMembership(base44, body.workspace_id);
      const audience = firstRecord(
        await sr.entities.Audience.filter({ id: body.id, workspace_id: body.workspace_id })
      );
      if (!audience) return err(404, "Audience not found");
      const revision = audienceContentHash(audience);
      const reqs = asArray(
        await sr.entities.PersonaPortraitRequest.filter(
          { audience_id: body.id, state: { $in: ["pending", "ready"] } },
          { sort: "-created_date", limit: 1 }
        )
      );
      return ok({ request: reqs[0] ? publicRequestView(reqs[0]) : null, audience_revision: revision });
    }

    if (action === "applyPersonaPortrait") {
      await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const audience = firstRecord(
        await sr.entities.Audience.filter({ id: body.id, workspace_id: body.workspace_id })
      );
      if (!audience) return err(404, "Audience not found");
      const req = firstRecord(
        await sr.entities.PersonaPortraitRequest.filter({
          request_id: body.request_id, audience_id: body.id, workspace_id: body.workspace_id,
        })
      );
      if (!req) return err(404, "Portrait request not found");
      if (req.state !== "ready" || !req.candidate_url) return err(400, "This portrait is not ready to apply");
      // Merge only portrait fields into the current persona — never replace the
      // whole object — so unsaved or newer edits to other fields are preserved.
      const persona = {
        ...(audience.persona || {}),
        portrait_url: req.candidate_url,
        portrait_credit: "AI-generated illustration of this audience — not a real customer.",
        portrait_origin: "ai",
        portrait_alt: "AI-generated illustrative portrait of this audience — not a real customer.",
        portrait_applied_at: new Date().toISOString(),
      };
      const updated = await sr.entities.Audience.update(body.id, { persona });
      await sr.entities.PersonaPortraitRequest.update(req.id, { state: "applied" });
      return ok({ audience: updated });
    }

    if (action === "dismissPersonaPortrait") {
      await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const req = firstRecord(
        await sr.entities.PersonaPortraitRequest.filter({
          request_id: body.request_id, audience_id: body.id, workspace_id: body.workspace_id,
        })
      );
      if (!req) return err(404, "Portrait request not found");
      await sr.entities.PersonaPortraitRequest.update(req.id, { state: "dismissed" });
      return ok({ dismissed: true });
    }

    return err(400, `Unknown action: ${action}`);
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}