import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import {
  requireMembership,
  resolveFunnelWorkspace,
  firstRecord,
  asArray,
  ok,
  err,
  HttpError,
} from "../../shared/auth.ts";

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Default page blocks for each template type
function defaultBlocks(type) {
  const hero = {
    id: crypto.randomUUID(),
    type: "hero",
    props: { headline: "", subheadline: "", cta_label: "Get started" },
  };
  const footer = {
    id: crypto.randomUUID(),
    type: "footer",
    props: { text: "", links: [] },
  };
  if (type === "lead_magnet") {
    return [
      hero,
      { id: crypto.randomUUID(), type: "benefits", props: { heading: "", items: [] } },
      { id: crypto.randomUUID(), type: "form", props: { heading: "", fields: [{ name: "name", label: "Name", type: "text", required: true }, { name: "email", label: "Email", type: "email", required: true }], submit_label: "Send me the resource" } },
      { id: crypto.randomUUID(), type: "resource", props: { heading: "", description: "", asset_title: "" } },
      { id: crypto.randomUUID(), type: "booking", props: { heading: "Prefer to talk? Book a call.", calendly_url: "" } },
      footer,
    ];
  }
  if (type === "direct_booking") {
    return [
      hero,
      { id: crypto.randomUUID(), type: "benefits", props: { heading: "", items: [] } },
      { id: crypto.randomUUID(), type: "booking", props: { heading: "Book your session", calendly_url: "" } },
      footer,
    ];
  }
  // service_inquiry
  return [
    hero,
    { id: crypto.randomUUID(), type: "benefits", props: { heading: "", items: [] } },
    { id: crypto.randomUUID(), type: "form", props: { heading: "Tell us what you need", fields: [{ name: "name", label: "Name", type: "text", required: true }, { name: "email", label: "Email", type: "email", required: true }, { name: "message", label: "How can we help?", type: "textarea", required: true }], submit_label: "Send inquiry" } },
    footer,
  ];
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const sr = base44.asServiceRole;

    // ---- list ----
    if (action === "list") {
      await requireMembership(base44, body.workspace_id);
      const funnels = asArray(
        await sr.entities.Funnel.filter({ workspace_id: body.workspace_id }, { sort: "-created_date" })
      );
      return ok({ funnels });
    }

    // ---- get (funnel + draft) ----
    if (action === "get") {
      const { funnel, workspaceId } = await resolveFunnelWorkspace(base44, body.funnel_id);
      await requireMembership(base44, workspaceId);
      let draft = firstRecord(
        await sr.entities.FunnelDraft.filter({ funnel_id: funnel.id })
      );
      if (!draft) {
        draft = await sr.entities.FunnelDraft.create({
          funnel_id: funnel.id,
          workspace_id: workspaceId,
          page_blocks: defaultBlocks(funnel.type),
          theme: { primary_color: "#4f46e5", accent_color: "#0ea5e9", font: "Inter" },
          form_config: { fields: [], submit_label: "Submit" },
          booking_config: { calendly_url: "", event_type: "" },
          publishing_checks: {},
          wizard_progress: { step: 1, completed_steps: [] },
        });
      }
      return ok({ funnel, draft });
    }

    // ---- create ----
    if (action === "create") {
      await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const name = String(body.name || "").trim();
      const type = body.type;
      if (!name) return err(400, "Funnel name is required");
      if (!["lead_magnet", "direct_booking", "service_inquiry"].includes(type)) {
        return err(400, "Invalid funnel type");
      }
      let slug = slugify(body.slug || name);
      const existing = asArray(
        await sr.entities.Funnel.filter({ workspace_id: body.workspace_id, slug })
      );
      if (existing.length) slug = `${slug}-${Math.random().toString(36).slice(2, 5)}`;
      const funnel = await sr.entities.Funnel.create({
        workspace_id: body.workspace_id,
        name,
        type,
        goal: body.goal || type,
        slug,
        state: "draft",
        wizard_step: 1,
        audience_id: body.audience_id || "",
        offer_id: body.offer_id || "",
      });
      const draft = await sr.entities.FunnelDraft.create({
        funnel_id: funnel.id,
        workspace_id: body.workspace_id,
        page_blocks: defaultBlocks(type),
        theme: { primary_color: "#4f46e5", accent_color: "#0ea5e9", font: "Inter" },
        form_config: { fields: [], submit_label: "Submit" },
        booking_config: { calendly_url: "", event_type: "" },
        publishing_checks: {},
        wizard_progress: { step: 1, completed_steps: [] },
      });
      return ok({ funnel, draft });
    }

    // ---- update funnel meta ----
    if (action === "update") {
      const { funnel, workspaceId } = await resolveFunnelWorkspace(base44, body.funnel_id);
      await requireMembership(base44, workspaceId, ["owner", "admin", "member"]);
      const update = {};
      for (const k of ["name", "type", "goal", "slug", "state", "audience_id", "offer_id", "wizard_step"]) {
        if (body[k] !== undefined) update[k] = body[k];
      }
      if (update.slug) update.slug = slugify(update.slug);
      const funnelUpdated = await sr.entities.Funnel.update(funnel.id, update);
      return ok({ funnel: funnelUpdated });
    }

    // ---- saveDraft ----
    if (action === "saveDraft") {
      const { funnel, workspaceId } = await resolveFunnelWorkspace(base44, body.funnel_id);
      await requireMembership(base44, workspaceId, ["owner", "admin", "member"]);
      const draft = firstRecord(
        await sr.entities.FunnelDraft.filter({ funnel_id: funnel.id })
      );
      const update = {};
      for (const k of ["page_blocks", "theme", "form_config", "resource_id", "sequence_ref", "booking_config", "publishing_checks", "wizard_progress"]) {
        if (body[k] !== undefined) update[k] = body[k];
      }
      let result;
      if (draft) {
        result = await sr.entities.FunnelDraft.update(draft.id, update);
      } else {
        result = await sr.entities.FunnelDraft.create({
          funnel_id: funnel.id,
          workspace_id: workspaceId,
          ...update,
        });
      }
      return ok({ draft: result });
    }

    // ---- publish: create immutable snapshot, set active ----
    if (action === "publish") {
      const { funnel, workspaceId } = await resolveFunnelWorkspace(base44, body.funnel_id);
      await requireMembership(base44, workspaceId, ["owner", "admin"]);
      const draft = firstRecord(
        await sr.entities.FunnelDraft.filter({ funnel_id: funnel.id })
      );
      if (!draft) return err(400, "Nothing to publish — save a draft first");
      // template-specific publishing checks
      const checks = draft.publishing_checks || {};
      if (funnel.type === "lead_magnet") {
        if (!checks.has_form) return err(400, "Lead magnet funnels require a lead form before publishing");
        if (!checks.has_resource) return err(400, "Lead magnet funnels require a resource before publishing");
      }
      if (funnel.type === "direct_booking" && !checks.has_booking) {
        return err(400, "Direct booking funnels require a booking connection before publishing");
      }
      // count existing versions
      const versions = asArray(
        await sr.entities.PublishedFunnelVersion.filter({ funnel_id: funnel.id })
      );
      const versionNumber = versions.length + 1;
      // deactivate previous active version
      if (funnel.active_version_id) {
        await sr.entities.PublishedFunnelVersion.update(funnel.active_version_id, {
          active: false,
        });
      }
      const snapshot = {
        page_blocks: draft.page_blocks,
        theme: draft.theme,
        form_config: draft.form_config,
        booking_config: draft.booking_config,
        funnel_name: funnel.name,
        funnel_type: funnel.type,
        goal: funnel.goal,
      };
      const version = await sr.entities.PublishedFunnelVersion.create({
        funnel_id: funnel.id,
        workspace_id: workspaceId,
        version_number: versionNumber,
        snapshot,
        published_at: new Date().toISOString(),
        published_by: (await base44.auth.me()).id,
        active: true,
      });
      await sr.entities.Funnel.update(funnel.id, {
        state: "published",
        active_version_id: version.id,
      });
      return ok({ version });
    }

    // ---- listVersions ----
    if (action === "listVersions") {
      const { funnel, workspaceId } = await resolveFunnelWorkspace(base44, body.funnel_id);
      await requireMembership(base44, workspaceId);
      const versions = asArray(
        await sr.entities.PublishedFunnelVersion.filter(
          { funnel_id: funnel.id },
          { sort: "-version_number" }
        )
      );
      return ok({ versions });
    }

    // ---- rollback: activate a prior version ----
    if (action === "rollback") {
      const { funnel, workspaceId } = await resolveFunnelWorkspace(base44, body.funnel_id);
      await requireMembership(base44, workspaceId, ["owner", "admin"]);
      const version = firstRecord(
        await sr.entities.PublishedFunnelVersion.filter({
          id: body.version_id,
          funnel_id: funnel.id,
        })
      );
      if (!version) return err(404, "Version not found");
      if (funnel.active_version_id) {
        await sr.entities.PublishedFunnelVersion.update(funnel.active_version_id, {
          active: false,
        });
      }
      await sr.entities.PublishedFunnelVersion.update(version.id, { active: true });
      await sr.entities.Funnel.update(funnel.id, { active_version_id: version.id, state: "published" });
      return ok({ version });
    }

    // ---- pause / resume ----
    if (action === "setState") {
      const { funnel, workspaceId } = await resolveFunnelWorkspace(base44, body.funnel_id);
      await requireMembership(base44, workspaceId, ["owner", "admin"]);
      const funnelUpdated = await sr.entities.Funnel.update(funnel.id, { state: body.state });
      return ok({ funnel: funnelUpdated });
    }

    // ---- delete ----
    if (action === "delete") {
      const { funnel, workspaceId } = await resolveFunnelWorkspace(base44, body.funnel_id);
      await requireMembership(base44, workspaceId, ["owner", "admin"]);
      await sr.entities.Funnel.delete(funnel.id);
      return ok({ deleted: true });
    }

    return err(400, `Unknown action: ${action}`);
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}