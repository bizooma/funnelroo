import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import {
  requireMembership,
  firstRecord,
  asArray,
  ok,
  err,
  HttpError,
} from "../../shared/auth.ts";
import {
  defaultSteps,
  validateSteps,
  isProviderConfigured,
  isWebhookSecretConfigured,
  sendNurtureEmail,
  renderEmailHtml,
  renderEmailText,
  renderMergeFields,
  buildMergeContext,
  buildUnsubscribeUrl,
  ensureUnsubscribeToken,
  checkActivation,
  stopAllEnrollments,
  getWorkspaceMetrics,
} from "../../shared/nurture.ts";

// Workspace-authorized nurture sequence management: CRUD, review, activate,
// pause, resume, archive, test send, reporting.
//
// Lifecycle: draft → ready (review) → active (activate) → paused → archived.
// Publishing the funnel binds the current approved version into the snapshot.
// Activate enables new enrollment + sending after all checks pass.

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const sr = base44.asServiceRole;

    // ---- get: load sequence + current version for a funnel ----
    if (action === "get") {
      const funnel = firstRecord(await sr.entities.Funnel.filter({ id: body.funnel_id }));
      if (!funnel) return err(404, "Funnel not found");
      await requireMembership(base44, funnel.workspace_id);
      let sequence = firstRecord(
        await sr.entities.NurtureSequence.filter({ funnel_id: funnel.id })
      );
      let currentVersion = null;
      let versions = [];
      if (sequence) {
        versions = asArray(
          await sr.entities.NurtureSequenceVersion.filter(
            { sequence_id: sequence.id },
            { sort: "-version_number" }
          )
        );
        if (sequence.current_version_id) {
          currentVersion = firstRecord(
            await sr.entities.NurtureSequenceVersion.filter({ id: sequence.current_version_id })
          );
        }
      }
      const senders = asArray(
        await sr.entities.SenderIdentity.filter({ workspace_id: funnel.workspace_id }, { sort: "-created_date" })
      );
      return ok({
        sequence,
        current_version: currentVersion,
        versions: versions.map((v) => ({ version_number: v.version_number, approved_at: v.approved_at, active: v.active })),
        senders,
        provider_configured: isProviderConfigured(),
        webhook_configured: isWebhookSecretConfigured(),
      });
    }

    // ---- create: initialize a sequence for a funnel with default steps ----
    if (action === "create") {
      const funnel = firstRecord(await sr.entities.Funnel.filter({ id: body.funnel_id }));
      if (!funnel) return err(404, "Funnel not found");
      const { membership } = await requireMembership(base44, funnel.workspace_id, ["owner", "admin", "member"]);
      // Check if one already exists
      const existing = firstRecord(
        await sr.entities.NurtureSequence.filter({ funnel_id: funnel.id })
      );
      if (existing) return ok({ sequence: existing });
      const sequence = await sr.entities.NurtureSequence.create({
        workspace_id: funnel.workspace_id,
        name: funnel.name + " — nurture",
        funnel_id: funnel.id,
        status: "draft",
        draft_steps: defaultSteps(),
        sending_enabled: false,
      });
      // Link to the funnel draft
      const draft = firstRecord(await sr.entities.FunnelDraft.filter({ funnel_id: funnel.id }));
      if (draft) {
        await sr.entities.FunnelDraft.update(draft.id, { sequence_ref: sequence.id });
      }
      return ok({ sequence });
    }

    // ---- saveDraft: save draft steps, sender, booking_url ----
    if (action === "saveDraft") {
      const sequence = firstRecord(await sr.entities.NurtureSequence.filter({ id: body.sequence_id }));
      if (!sequence) return err(404, "Sequence not found");
      await requireMembership(base44, sequence.workspace_id, ["owner", "admin", "member"]);
      const update = {};
      if (body.draft_steps !== undefined) {
        // Basic structural validation; full validation happens at review
        if (!Array.isArray(body.draft_steps) || body.draft_steps.length < 3 || body.draft_steps.length > 5) {
          return err(400, "Sequence must have 3 to 5 steps");
        }
        update.draft_steps = body.draft_steps;
      }
      if (body.name !== undefined) update.name = String(body.name).slice(0, 100);
      if (body.sender_id !== undefined) {
        const sid = String(body.sender_id || "").trim();
        if (sid) {
          const sender = firstRecord(
            await sr.entities.SenderIdentity.filter({ id: sid, workspace_id: sequence.workspace_id })
          );
          if (!sender) return err(400, "Sender does not belong to this workspace");
        }
        update.sender_id = sid;
      }
      if (body.booking_url !== undefined) {
        const url = String(body.booking_url || "").trim();
        if (url && !/^https:\/\//i.test(url)) return err(400, "Booking URL must start with https://");
        update.booking_url = url;
      }
      if (body.reply_to !== undefined) {
        update.reply_to = String(body.reply_to).trim();
      }
      const result = await sr.entities.NurtureSequence.update(sequence.id, update);
      return ok({ sequence: result });
    }

    // ---- review: create an immutable approved version (owner/admin) ----
    if (action === "review") {
      const sequence = firstRecord(await sr.entities.NurtureSequence.filter({ id: body.sequence_id }));
      if (!sequence) return err(404, "Sequence not found");
      const { user } = await requireMembership(base44, sequence.workspace_id, ["owner", "admin"]);
      // Validate steps
      const stepErrors = validateSteps(sequence.draft_steps);
      if (stepErrors.length) return err(400, stepErrors.join("; "));
      // Require sender
      if (!sequence.sender_id) return err(400, "Select a sender before reviewing");
      const sender = firstRecord(
        await sr.entities.SenderIdentity.filter({ id: sequence.sender_id, workspace_id: sequence.workspace_id })
      );
      if (!sender) return err(400, "Selected sender no longer exists");
      // Load approved context (audience, offer, funnel type)
      const funnel = firstRecord(await sr.entities.Funnel.filter({ id: sequence.funnel_id }));
      const draft = firstRecord(await sr.entities.FunnelDraft.filter({ funnel_id: sequence.funnel_id }));
      const versionNumber = (asArray(
        await sr.entities.NurtureSequenceVersion.filter({ sequence_id: sequence.id })
      ).length) + 1;
      // Deactivate previous active version
      if (sequence.current_version_id) {
        await sr.entities.NurtureSequenceVersion.update(sequence.current_version_id, { active: false });
      }
      const version = await sr.entities.NurtureSequenceVersion.create({
        workspace_id: sequence.workspace_id,
        sequence_id: sequence.id,
        version_number: versionNumber,
        steps: sequence.draft_steps,
        sender_id: sequence.sender_id,
        reply_to: sequence.reply_to || "",
        booking_url: sequence.booking_url || "",
        approved_context: {
          audience_id: funnel?.audience_id || "",
          offer_id: funnel?.offer_id || "",
          resource_version_id: draft?.resource_version_id || "",
          funnel_type: funnel?.type || "",
        },
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        active: true,
      });
      const updated = await sr.entities.NurtureSequence.update(sequence.id, {
        current_version_id: version.id,
        status: "ready",
      });
      return ok({ sequence: updated, version });
    }

    // ---- activate: enable sending after all checks pass (owner/admin) ----
    if (action === "activate") {
      const sequence = firstRecord(await sr.entities.NurtureSequence.filter({ id: body.sequence_id }));
      if (!sequence) return err(404, "Sequence not found");
      await requireMembership(base44, sequence.workspace_id, ["owner", "admin"]);
      if (sequence.status !== "ready" && sequence.status !== "paused") {
        return err(400, `Cannot activate from status: ${sequence.status}. Review first.`);
      }
      const version = firstRecord(
        await sr.entities.NurtureSequenceVersion.filter({ id: sequence.current_version_id })
      );
      const check = await checkActivation(sr, sequence.workspace_id, sequence, version);
      if (!check.ok) {
        return Response.json({ error: "Activation blocked", blockers: check.blockers }, { status: 400 });
      }
      const updated = await sr.entities.NurtureSequence.update(sequence.id, {
        status: "active",
        sending_enabled: true,
      });
      return ok({ sequence: updated });
    }

    // ---- pause: stop new enrollments + hold remaining sends ----
    if (action === "pause") {
      const sequence = firstRecord(await sr.entities.NurtureSequence.filter({ id: body.sequence_id }));
      if (!sequence) return err(404, "Sequence not found");
      await requireMembership(base44, sequence.workspace_id, ["owner", "admin"]);
      if (sequence.status !== "active") return err(400, "Only active sequences can be paused");
      const updated = await sr.entities.NurtureSequence.update(sequence.id, {
        status: "paused",
        sending_enabled: false,
      });
      return ok({ sequence: updated });
    }

    // ---- resume: restore active state (does NOT approve a new version) ----
    if (action === "resume") {
      const sequence = firstRecord(await sr.entities.NurtureSequence.filter({ id: body.sequence_id }));
      if (!sequence) return err(404, "Sequence not found");
      await requireMembership(base44, sequence.workspace_id, ["owner", "admin"]);
      if (sequence.status !== "paused") return err(400, "Only paused sequences can be resumed");
      const version = firstRecord(
        await sr.entities.NurtureSequenceVersion.filter({ id: sequence.current_version_id })
      );
      const check = await checkActivation(sr, sequence.workspace_id, sequence, version);
      if (!check.ok) {
        return Response.json({ error: "Resume blocked", blockers: check.blockers }, { status: 400 });
      }
      const updated = await sr.entities.NurtureSequence.update(sequence.id, {
        status: "active",
        sending_enabled: true,
      });
      return ok({ sequence: updated });
    }

    // ---- archive: stop new enrollment + cancel remaining steps ----
    if (action === "archive") {
      const sequence = firstRecord(await sr.entities.NurtureSequence.filter({ id: body.sequence_id }));
      if (!sequence) return err(404, "Sequence not found");
      await requireMembership(base44, sequence.workspace_id, ["owner", "admin"]);
      const updated = await sr.entities.NurtureSequence.update(sequence.id, {
        status: "archived",
        sending_enabled: false,
      });
      // Cancel remaining queued messages for all enrollments in this sequence
      const enrollments = asArray(
        await sr.entities.NurtureEnrollment.filter({ sequence_id: sequence.id, state: { $in: ["active", "paused"] } })
      );
      for (const e of enrollments) {
        await sr.entities.NurtureEnrollment.update(e.id, { state: "stopped", stop_reason: "sequence_archived", stopped_at: new Date().toISOString() });
        await sr.entities.NurtureMessage.updateMany(
          { enrollment_id: e.id, outcome: "queued" },
          { $set: { outcome: "suppressed", last_error: "Sequence archived" } }
        );
      }
      return ok({ sequence: updated, stopped_enrollments: enrollments.length });
    }

    // ---- testSend: send a test email to the owner (owner/admin) ----
    // Does NOT enroll, change consent, or inflate metrics. Labeled TEST.
    if (action === "testSend") {
      const sequence = firstRecord(await sr.entities.NurtureSequence.filter({ id: body.sequence_id }));
      if (!sequence) return err(404, "Sequence not found");
      const { user } = await requireMembership(base44, sequence.workspace_id, ["owner", "admin"]);
      const stepIndex = Number(body.step_index || 0);
      const version = firstRecord(
        await sr.entities.NurtureSequenceVersion.filter({ id: sequence.current_version_id })
      );
      const steps = version?.steps || sequence.draft_steps || [];
      const step = steps[stepIndex];
      if (!step) return err(400, "Step not found");
      const sender = firstRecord(
        await sr.entities.SenderIdentity.filter({ id: sequence.sender_id, workspace_id: sequence.workspace_id })
      );
      if (!sender) return err(400, "No sender selected");
      // Rate limit: 1 test per 30 seconds per workspace
      const since = new Date(Date.now() - 30 * 1000).toISOString();
      const recentTests = await sr.entities.NurtureMessage.count({
        workspace_id: sequence.workspace_id,
        recipient_email: user.email,
        outcome: "provider_accepted",
        sent_at: { $gte: since },
      });
      if (recentTests > 0) return err(429, "Please wait 30 seconds between test sends");

      const profile = firstRecord(await sr.entities.BusinessProfile.filter({ workspace_id: sequence.workspace_id }));
      const ctx = {
        first_name: user.full_name?.split(" ")[0] || "there",
        last_name: user.full_name?.split(" ").slice(1).join(" ") || "",
        business_name: profile?.business_name || "",
        offer_name: "",
        booking_url: sequence.booking_url || "",
        resource_title: "",
      };
      const unsubUrl = buildUnsubscribeUrl(
        (() => { try { return new URL(req.url).origin; } catch { return ""; } })(),
        "test-not-a-real-token"
      );
      const html = renderEmailHtml(step, ctx, unsubUrl, ctx.business_name, sender.email);
      const text = renderEmailText(step, ctx, unsubUrl, ctx.business_name);
      const subject = "[TEST] " + renderMergeFields(step.subject, ctx);

      try {
        const result = await sendNurtureEmail({
          from: isProviderConfigured() ? `${sender.from_name || ""} <${sender.email}>` : sender.from_name || "",
          to: user.email,
          subject,
          html,
          text,
          headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          idempotencyKey: "test_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24),
        });
        return ok({ sent: true, mock: result.mock, message_id: result.messageId });
      } catch (e) {
        return ok({ sent: false, error: String(e?.message || e) });
      }
    }

    // ---- report: workspace-scoped metrics ----
    if (action === "report") {
      await requireMembership(base44, body.workspace_id);
      const metrics = await getWorkspaceMetrics(sr, body.workspace_id);
      return ok({ metrics });
    }

    // ---- getEnrollments: list enrollments for a contact ----
    if (action === "getEnrollments") {
      const contact = firstRecord(await sr.entities.Contact.filter({ id: body.contact_id }));
      if (!contact) return err(404, "Contact not found");
      await requireMembership(base44, contact.workspace_id);
      const enrollments = asArray(
        await sr.entities.NurtureEnrollment.filter(
          { workspace_id: contact.workspace_id, contact_id: contact.id },
          { sort: "-enrolled_at" }
        )
      );
      // Load messages for each enrollment
      const result = [];
      for (const e of enrollments) {
        const messages = asArray(
          await sr.entities.NurtureMessage.filter(
            { enrollment_id: e.id },
            { sort: "step_index" }
          )
        );
        const sequence = firstRecord(await sr.entities.NurtureSequence.filter({ id: e.sequence_id }));
        result.push({
          ...e,
          sequence_name: sequence?.name || "—",
          sequence_status: sequence?.status || "—",
          messages: messages.map((m) => ({
            step_index: m.step_index,
            outcome: m.outcome,
            due_at: m.due_at,
            sent_at: m.sent_at,
            last_error: m.last_error,
            subject: m.subject,
          })),
        });
      }
      return ok({ enrollments: result });
    }

    // ---- markBooked / markNotInterested: staff actions ----
    if (action === "markBooked" || action === "markNotInterested") {
      const contact = firstRecord(await sr.entities.Contact.filter({ id: body.contact_id }));
      if (!contact) return err(404, "Contact not found");
      const { user } = await requireMembership(base44, contact.workspace_id, ["owner", "admin", "member"]);
      const outcome = action === "markBooked" ? "booked" : "not_interested";
      const updated = await sr.entities.Contact.update(contact.id, {
        booking_outcome: outcome,
        booking_outcome_at: new Date().toISOString(),
        booking_outcome_by: user.id,
      });
      // Stop all active nurture enrollments for this contact
      const stopped = await stopAllEnrollments(sr, contact.workspace_id, contact.id, "staff:" + outcome, user.id);
      return ok({ contact: updated, stopped_enrollments: stopped });
    }

    // ---- clearBookingOutcome: clear the outcome (does NOT restart stopped sequences) ----
    if (action === "clearBookingOutcome") {
      const contact = firstRecord(await sr.entities.Contact.filter({ id: body.contact_id }));
      if (!contact) return err(404, "Contact not found");
      await requireMembership(base44, contact.workspace_id, ["owner", "admin", "member"]);
      const updated = await sr.entities.Contact.update(contact.id, {
        booking_outcome: null,
        booking_outcome_at: null,
        booking_outcome_by: null,
      });
      return ok({ contact: updated });
    }

    // ---- preview: render a step with sample data (no send) ----
    if (action === "preview") {
      const sequence = firstRecord(await sr.entities.NurtureSequence.filter({ id: body.sequence_id }));
      if (!sequence) return err(404, "Sequence not found");
      await requireMembership(base44, sequence.workspace_id);
      const stepIndex = Number(body.step_index || 0);
      const version = firstRecord(
        await sr.entities.NurtureSequenceVersion.filter({ id: sequence.current_version_id })
      );
      const steps = version?.steps || sequence.draft_steps || [];
      const step = steps[stepIndex];
      if (!step) return err(400, "Step not found");
      const profile = firstRecord(await sr.entities.BusinessProfile.filter({ workspace_id: sequence.workspace_id }));
      const ctx = {
        first_name: body.sample_name || "Jordan",
        last_name: "",
        business_name: profile?.business_name || "your business",
        offer_name: "",
        booking_url: sequence.booking_url || "https://calendly.com/your-link",
        resource_title: "your resource",
      };
      const origin = (() => { try { return new URL(req.url).origin; } catch { return ""; } })();
      const html = renderEmailHtml(step, ctx, buildUnsubscribeUrl(origin, "preview-token"), ctx.business_name, "sender@example.com");
      const text = renderEmailText(step, ctx, buildUnsubscribeUrl(origin, "preview-token"), ctx.business_name);
      return ok({
        subject: renderMergeFields(step.subject, ctx),
        html,
        text,
      });
    }

    return err(400, `Unknown action: ${action}`);
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}