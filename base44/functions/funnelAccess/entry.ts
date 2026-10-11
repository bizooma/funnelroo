import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import {
  requireMembership,
  resolveFunnelWorkspace,
  firstRecord,
  asArray,
  ok,
  err,
  HttpError,
  generatePublicId,
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

// Ensure a funnel has a public_id (generates one if missing, atomically)
async function ensurePublicId(sr, funnel) {
  if (funnel.public_id) return funnel;
  const publicId = generatePublicId();
  await sr.entities.Funnel.updateMany(
    { id: funnel.id, public_id: null },
    { $set: { public_id } }
  );
  const refreshed = firstRecord(await sr.entities.Funnel.filter({ id: funnel.id }));
  return refreshed || funnel;
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
      // Backfill public_id for any funnels missing one
      for (const f of funnels) {
        if (!f.public_id) await ensurePublicId(sr, f);
      }
      const refreshed = asArray(
        await sr.entities.Funnel.filter({ workspace_id: body.workspace_id }, { sort: "-created_date" })
      );
      return ok({ funnels: refreshed });
    }

    // ---- get (funnel + draft) ----
    if (action === "get") {
      const { funnel, workspaceId } = await resolveFunnelWorkspace(base44, body.funnel_id);
      await requireMembership(base44, workspaceId);
      const funnelWithPid = await ensurePublicId(sr, funnel);
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
      return ok({ funnel: funnelWithPid, draft });
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
      if (!slug) slug = "funnel-" + Date.now().toString(36);
      // workspace-scoped slug uniqueness
      const existing = asArray(
        await sr.entities.Funnel.filter({ workspace_id: body.workspace_id, slug })
      );
      if (existing.length) slug = `${slug}-${Math.random().toString(36).slice(2, 5)}`;
      // globally-unique public_id for public URLs
      let publicId = generatePublicId();
      const existingPublic = firstRecord(await sr.entities.Funnel.filter({ public_id: publicId }));
      if (existingPublic) publicId = generatePublicId() + Date.now().toString(36);
      const funnel = await sr.entities.Funnel.create({
        workspace_id: body.workspace_id,
        name,
        type,
        goal: body.goal || type,
        slug,
        public_id: publicId,
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
    // Protected lifecycle fields (state, public_id) are NOT settable here.
    // state changes go through setState (owner/admin only).
    if (action === "update") {
      const { funnel, workspaceId } = await resolveFunnelWorkspace(base44, body.funnel_id);
      await requireMembership(base44, workspaceId, ["owner", "admin", "member"]);
      const update = {};
      // Only non-protected metadata fields are settable
      for (const k of ["name", "type", "goal", "slug", "audience_id", "offer_id", "wizard_step"]) {
        if (body[k] !== undefined) update[k] = body[k];
      }
      if (update.slug) {
        update.slug = slugify(update.slug);
        if (!update.slug) return err(400, "Invalid slug");
        // workspace-scoped slug uniqueness (excluding self)
        const existing = asArray(
          await sr.entities.Funnel.filter({ workspace_id: workspaceId, slug: update.slug })
        );
        if (existing.length && existing[0].id !== funnel.id) {
          return err(400, "That slug is already used by another funnel in this workspace");
        }
      }
      // public_id is immutable — never allow it to change
      delete update.public_id;
      // state is protected — never allow it via generic update
      delete update.state;
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
      // delivery_mode: validate enum
      if (body.delivery_mode !== undefined) {
        const dm = String(body.delivery_mode);
        if (!["immediate_only", "immediate_plus_email"].includes(dm)) {
          return err(400, "Invalid delivery mode");
        }
        update.delivery_mode = dm;
      }
      // sender_id: validate workspace ownership
      if (body.sender_id !== undefined) {
        const sid = String(body.sender_id || "").trim();
        if (sid) {
          const sender = firstRecord(
            await sr.entities.SenderIdentity.filter({ id: sid, workspace_id: workspaceId })
          );
          if (!sender) return err(400, "Sender does not belong to this workspace");
        }
        update.sender_id = sid;
      }
      // consent_text: validate string, max length
      if (body.consent_text !== undefined) {
        update.consent_text = String(body.consent_text).slice(0, 500);
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

    // ---- detachResource: clear draft references, preserve published snapshots + grants ----
    if (action === "detachResource") {
      const { funnel, workspaceId } = await resolveFunnelWorkspace(base44, body.funnel_id);
      await requireMembership(base44, workspaceId, ["owner", "admin", "member"]);
      const draft = firstRecord(
        await sr.entities.FunnelDraft.filter({ funnel_id: funnel.id })
      );
      if (!draft) return err(400, "No draft to update");
      // Clear both draft references. Published snapshots keep their resource_version_id
      // and existing grants remain valid (they reference the version, not the draft).
      await sr.entities.FunnelDraft.update(draft.id, {
        resource_id: "",
        resource_version_id: "",
      });
      return ok({ detached: true });
    }

    // ---- publish: create immutable snapshot, set active ----
    if (action === "publish") {
      const { funnel, workspaceId } = await resolveFunnelWorkspace(base44, body.funnel_id);
      await requireMembership(base44, workspaceId, ["owner", "admin"]);
      const draft = firstRecord(
        await sr.entities.FunnelDraft.filter({ funnel_id: funnel.id })
      );
      if (!draft) return err(400, "Nothing to publish — save a draft first");
      const checks = draft.publishing_checks || {};
      const blocks = draft.page_blocks || [];
      const hasForm = blocks.some((b) => b.type === "form");
      if (funnel.type === "lead_magnet") {
        if (!hasForm) return err(400, "Lead magnet funnels require a lead form before publishing");
        if (!draft.resource_version_id) return err(400, "Attach an approved resource version before publishing");
      }
      if (funnel.type === "service_inquiry" && !hasForm) {
        return err(400, "Service inquiry funnels require a lead form before publishing");
      }
      if (funnel.type === "direct_booking" && !checks.has_booking) {
        return err(400, "Direct booking funnels require a booking connection before publishing");
      }
      // Server-side form schema validation: the editor cannot produce a published
      // capture form with no usable canonical/mapped email field.
      const SUPPORTED_FIELD_TYPES = ["text", "email", "textarea"];
      if (hasForm) {
        const formBlock = blocks.find((b) => b.type === "form");
        const formFields = formBlock?.props?.fields || [];
        if (!formFields.length) {
          return err(400, "The form has no fields. Add at least an email field before publishing.");
        }
        let hasEmail = false;
        for (const f of formFields) {
          if (!f.name || !String(f.name).trim()) {
            return err(400, "Every form field needs a name. Fix the empty field name before publishing.");
          }
          if (!f.label || !String(f.label).trim()) {
            return err(400, `Field "${f.name}" has no label. Add a label before publishing.`);
          }
          const ft = String(f.type || "text");
          if (!SUPPORTED_FIELD_TYPES.includes(ft)) {
            return err(400, `Field "${f.name}" has an unsupported type ("${ft}"). Supported: text, email, textarea.`);
          }
          if (ft === "email" || String(f.name).toLowerCase() === "email") hasEmail = true;
        }
        if (!hasEmail) {
          return err(400, "The form must include an email field (type \"email\" or name \"email\") for contact capture.");
        }
      }
      const deliveryMode = draft.delivery_mode || "immediate_only";
      let senderVerified = false;
      if (deliveryMode === "immediate_plus_email") {
        if (!draft.sender_id) return err(400, "Email delivery is enabled but no sender is selected");
        const sender = firstRecord(await sr.entities.SenderIdentity.filter({ id: draft.sender_id, workspace_id: workspaceId }));
        if (!sender) return err(400, "Selected sender no longer exists");
        // Sender does not need to be domain-verified with the platform provider.
        // The platform sends from its own address; sender_verified means the
        // sender was configured and valid at publish time, not domain-verified.
        senderVerified = true;
      }
      const formBlock = blocks.find((b) => b.type === "form");
      const formFields = formBlock?.props?.fields || [];
      const formVersion = JSON.stringify(formFields.map((f) => ({ n: f.name, l: f.label, t: f.type, r: !!f.required })));
      let resourceTitle = "";
      if (draft.resource_version_id) {
        const rv = firstRecord(await sr.entities.ResourceVersion.filter({ id: draft.resource_version_id, workspace_id: workspaceId }));
        if (rv) {
          const resource = firstRecord(await sr.entities.Resource.filter({ id: rv.resource_id }));
          resourceTitle = resource?.title || "";
        }
      }
      const versions = asArray(
        await sr.entities.PublishedFunnelVersion.filter({ funnel_id: funnel.id })
      );
      const versionNumber = versions.length + 1;
      if (funnel.active_version_id) {
        await sr.entities.PublishedFunnelVersion.update(funnel.active_version_id, {
          active: false,
        });
      }
      // Resolve nurture sequence version (if the funnel has one with an approved version)
      let nurtureSequenceVersionId = "";
      if (draft.sequence_ref) {
        const nurtureSeq = firstRecord(
          await sr.entities.NurtureSequence.filter({ id: draft.sequence_ref, workspace_id: workspaceId })
        );
        if (nurtureSeq?.current_version_id) {
          const nurtureVer = firstRecord(
            await sr.entities.NurtureSequenceVersion.filter({ id: nurtureSeq.current_version_id, workspace_id: workspaceId })
          );
          if (nurtureVer?.active) {
            nurtureSequenceVersionId = nurtureVer.id;
          }
        }
      }
      const snapshot = {
        page_blocks: draft.page_blocks,
        theme: draft.theme,
        form_config: draft.form_config,
        booking_config: draft.booking_config,
        funnel_name: funnel.name,
        funnel_type: funnel.type,
        goal: funnel.goal,
        resource_version_id: draft.resource_version_id || "",
        resource_title: resourceTitle,
        delivery_mode: deliveryMode,
        sender_id: draft.sender_id || "",
        consent_text: draft.consent_text || "",
        form_version: formVersion,
        sender_verified: senderVerified,
        nurture_sequence_version_id: nurtureSequenceVersionId,
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

    // ---- pause / resume (owner/admin only) ----
    // Enforces permitted state transitions consistently.
    if (action === "setState") {
      const { funnel, workspaceId } = await resolveFunnelWorkspace(base44, body.funnel_id);
      await requireMembership(base44, workspaceId, ["owner", "admin"]);
      const newState = body.state;
      if (!["draft", "published", "paused", "archived"].includes(newState)) {
        return err(400, "Invalid state");
      }
      // Permitted transitions
      const from = funnel.state;
      const allowed: Record<string, string[]> = {
        draft: ["published", "archived"],
        published: ["paused", "archived"],
        paused: ["published", "archived"],
        archived: ["draft"],
      };
      if (!allowed[from]?.includes(newState)) {
        return err(400, `Cannot transition from ${from} to ${newState}`);
      }
      const funnelUpdated = await sr.entities.Funnel.update(funnel.id, { state: newState });
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