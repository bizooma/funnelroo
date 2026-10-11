import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import {
  requireMembership,
  firstRecord,
  asArray,
  ok,
  err,
  HttpError,
} from "../../shared/auth.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const sr = base44.asServiceRole;

    // ---- getBrief: profile + audiences + offers ----
    if (action === "getBrief") {
      await requireMembership(base44, body.workspace_id);
      const profile = firstRecord(
        await sr.entities.BusinessProfile.filter({ workspace_id: body.workspace_id })
      );
      const audiences = asArray(
        await sr.entities.Audience.filter({ workspace_id: body.workspace_id })
      );
      const offers = asArray(
        await sr.entities.Offer.filter({ workspace_id: body.workspace_id })
      );
      return ok({ profile, audiences, offers });
    }

    // ---- updateBusinessProfile ----
    if (action === "updateBusinessProfile") {
      await requireMembership(base44, body.workspace_id);
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

    // ---- saveAudience (create or update) ----
    if (action === "saveAudience") {
      await requireMembership(base44, body.workspace_id);
      const data = {
        workspace_id: body.workspace_id,
        name: body.name,
        roles_industries: body.roles_industries,
        problems: body.problems || [],
        desired_outcomes: body.desired_outcomes || [],
        objections: body.objections || [],
        alternatives: body.alternatives || [],
        approved: body.approved !== undefined ? body.approved : false,
        ai_suggested: body.ai_suggested !== undefined ? body.ai_suggested : false,
      };
      let audience;
      if (body.id) {
        audience = await sr.entities.Audience.update(body.id, data);
      } else {
        audience = await sr.entities.Audience.create(data);
      }
      return ok({ audience });
    }

    if (action === "deleteAudience") {
      await requireMembership(base44, body.workspace_id);
      const audience = firstRecord(
        await sr.entities.Audience.filter({ id: body.id, workspace_id: body.workspace_id })
      );
      if (!audience) return err(404, "Audience not found");
      await sr.entities.Audience.delete(body.id);
      return ok({ deleted: true });
    }

    // ---- saveOffer ----
    if (action === "saveOffer") {
      await requireMembership(base44, body.workspace_id);
      const data = {
        workspace_id: body.workspace_id,
        name: body.name,
        offer: body.offer,
        goal: body.goal,
        cta: body.cta,
        supporting_proof: body.supporting_proof || [],
        approved: body.approved !== undefined ? body.approved : false,
        ai_suggested: body.ai_suggested !== undefined ? body.ai_suggested : false,
      };
      let offer;
      if (body.id) {
        offer = await sr.entities.Offer.update(body.id, data);
      } else {
        offer = await sr.entities.Offer.create(data);
      }
      return ok({ offer });
    }

    if (action === "deleteOffer") {
      await requireMembership(base44, body.workspace_id);
      const offer = firstRecord(
        await sr.entities.Offer.filter({ id: body.id, workspace_id: body.workspace_id })
      );
      if (!offer) return err(404, "Offer not found");
      await sr.entities.Offer.delete(body.id);
      return ok({ deleted: true });
    }

    return err(400, `Unknown action: ${action}`);
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}