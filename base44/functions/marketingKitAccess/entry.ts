import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import {
  requireMembership,
  firstRecord,
  asArray,
  ok,
  err,
  HttpError,
} from "../../shared/auth.ts";
import { evaluateReadiness, nextDashboardAction } from "../../shared/readiness.ts";

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
        audience = await sr.entities.Audience.update(body.id, { ...data, name: body.name });
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

    return err(400, `Unknown action: ${action}`);
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}