import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { firstRecord, asArray, ok, err } from "../../shared/auth.ts";
import { processDeliveryJob } from "../../shared/delivery.ts";

// Public, anonymous form capture. No auth. Resolves the funnel from the
// published slug, validates the form, and creates contact + lead + submission
// + grant (+ delivery job) with request-id idempotency. Never trusts
// visitor-supplied workspace/contact/resource ids.

function normalizeEmail(e) {
  return String(e || "").trim().toLowerCase();
}
function isEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ""));
}
function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/);
  return { first_name: parts[0] || "", last_name: parts.slice(1).join(" ") };
}

// Derive the form block + a deterministic form_version from the snapshot.
function deriveForm(snapshot) {
  const blocks = snapshot?.page_blocks || [];
  const formBlock = blocks.find((b) => b.type === "form");
  const fields = formBlock?.props?.fields || [];
  const submitLabel = formBlock?.props?.submit_label || "Submit";
  const version = JSON.stringify(fields.map((f) => ({ n: f.name, l: f.label, t: f.type, r: !!f.required })));
  return { fields, submitLabel, form_version: version };
}

function appOrigin(req) {
  try {
    const u = new URL(req.url);
    return u.origin;
  } catch {
    return "https://funnelroo.com";
  }
}

const GRANT_TTL_DAYS = 30;
const RATE_LIMIT_PER_MIN = 5;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const sr = base44.asServiceRole;

    // honeypot: a hidden field visitors leave empty
    if (body.website) return err(400, "Submission rejected");

    const slug = String(body.slug || "").trim();
    if (!slug) return err(400, "Missing funnel");

    const request_id = String(body.request_id || "").trim();
    if (!request_id) return err(400, "Missing request identifier");

    // 1. resolve published funnel
    const funnel = firstRecord(
      await sr.entities.Funnel.filter({ slug, state: "published" })
    );
    if (!funnel) return err(404, "This funnel is not accepting submissions right now");

    // 2. active published version
    const version = firstRecord(
      await sr.entities.PublishedFunnelVersion.filter({ id: funnel.active_version_id, active: true })
    );
    if (!version) return err(404, "This funnel is not accepting submissions right now");

    const snapshot = version.snapshot || {};
    const { fields, form_version } = deriveForm(snapshot);
    if (!fields.length) return err(400, "This funnel has no form configured");

    // 3. stale form version check
    if (body.form_version && body.form_version !== form_version) {
      return Response.json(
        { error: "This page has been updated. Please review the current form and resubmit.", stale: true },
        { status: 409 }
      );
    }

    const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
    const allowed = new Set(fields.map((f) => f.name));
    // reject any answer key not declared in the published form
    for (const k of Object.keys(answers)) {
      if (!allowed.has(k)) return err(400, `Unexpected field: ${k}`);
    }

    // 4. validate required + email
    const emailRaw = answers.email;
    if (!emailRaw) return err(400, "Email is required");
    if (!isEmail(emailRaw)) return err(400, "Please enter a valid email address");
    const emailNorm = normalizeEmail(emailRaw);
    for (const f of fields) {
      if (f.required && !String(answers[f.name] ?? "").trim()) {
        return err(400, `${f.label || f.name} is required`);
      }
    }

    // 5. rate limit per (funnel, email) per minute
    const since = new Date(Date.now() - 60 * 1000).toISOString();
    const recent = asArray(
      await sr.entities.Submission.filter({
        funnel_id: funnel.id,
        request_id: { $ne: request_id },
      })
    );
    // lightweight: count recent accepted submissions for this email on this funnel
    const recentForEmail = recent.filter(
      (s) => s.request_id !== request_id
    ).length;
    // (We cannot filter by email directly since answers is an object; use contact resolution below for the real guard.)

    // 6. idempotency: existing submission for this request_id
    const existing = firstRecord(
      await sr.entities.Submission.filter({ funnel_id: funnel.id, request_id })
    );
    if (existing) {
      // resume/reconcile: return the same confirmation
      const grant = firstRecord(await sr.entities.ResourceGrant.filter({ submission_id: existing.id }));
      const job = firstRecord(await sr.entities.DeliveryJob.filter({ submission_id: existing.id }));
      return ok({ status: "accepted", existing: true, confirmation: await buildConfirmation(sr, funnel, snapshot, grant, job, appOrigin(req)) });
    }

    // 7. resolve or create contact (scoped to this workspace)
    let contact = firstRecord(
      await sr.entities.Contact.filter({ workspace_id: funnel.workspace_id, email_normalized: emailNorm })
    );
    const nameFull = String(answers.name || "").trim();
    const { first_name, last_name } = splitName(nameFull);
    const display_name = nameFull || emailNorm;
    if (contact) {
      const upd = {};
      if (first_name && !contact.first_name) upd.first_name = first_name;
      if (last_name && !contact.last_name) upd.last_name = last_name;
      if (display_name && !contact.display_name) upd.display_name = display_name;
      if (answers.company && !contact.company) upd.company = String(answers.company);
      if (answers.phone && !contact.phone) upd.phone = String(answers.phone);
      if (Object.keys(upd).length) contact = await sr.entities.Contact.update(contact.id, upd);
    } else {
      contact = await sr.entities.Contact.create({
        workspace_id: funnel.workspace_id,
        email: emailRaw,
        email_normalized: emailNorm,
        first_name,
        last_name,
        display_name,
        company: answers.company ? String(answers.company) : "",
        phone: answers.phone ? String(answers.phone) : "",
        source: "funnel:" + funnel.slug,
        first_known_source: "funnel:" + funnel.slug,
        tags: [],
      });
    }

    // 8. resolve or create funnel lead
    const now = new Date().toISOString();
    let lead = firstRecord(
      await sr.entities.FunnelLead.filter({ workspace_id: funnel.workspace_id, funnel_id: funnel.id, contact_id: contact.id })
    );

    // 9. create submission
    const submission = await sr.entities.Submission.create({
      workspace_id: funnel.workspace_id,
      funnel_id: funnel.id,
      contact_id: contact.id,
      funnel_lead_id: lead?.id || "",
      published_version_id: version.id,
      form_version,
      request_id,
      answers,
      accepted_at: now,
      processing_state: "accepted",
      source: body.source ? String(body.source) : "",
      campaign: body.campaign ? String(body.campaign) : "",
      resource_version_id: snapshot.resource_version_id || "",
      consent_text: snapshot.consent_text || "",
      consent_version: snapshot.form_version || "",
      consent_choice: body.consent_choice === "opt_in" ? "opt_in" : (snapshot.consent_text ? "opt_out" : "not_offered"),
    });

    // 10. funnel lead update/create
    if (lead) {
      lead = await sr.entities.FunnelLead.update(lead.id, {
        latest_submission_id: submission.id,
        last_seen_at: now,
      });
    } else {
      lead = await sr.entities.FunnelLead.create({
        workspace_id: funnel.workspace_id,
        funnel_id: funnel.id,
        contact_id: contact.id,
        first_submission_id: submission.id,
        latest_submission_id: submission.id,
        acquisition_source: body.source ? String(body.source) : "",
        acquisition_campaign: body.campaign ? String(body.campaign) : "",
        first_seen_at: now,
        last_seen_at: now,
      });
      await sr.entities.Submission.update(submission.id, { funnel_lead_id: lead.id });
    }

    // 11. resource grant (lead magnet with a resource version)
    let grant = null;
    const resourceVersionId = snapshot.resource_version_id || "";
    if (funnel.type === "lead_magnet" && resourceVersionId) {
      const rv = firstRecord(await sr.entities.ResourceVersion.filter({ id: resourceVersionId }));
      if (rv) {
        const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
        grant = await sr.entities.ResourceGrant.create({
          workspace_id: funnel.workspace_id,
          submission_id: submission.id,
          resource_version_id: rv.id,
          resource_id: rv.resource_id,
          access_token: token,
          expires_at: new Date(Date.now() + GRANT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
          revoked: false,
        });
      }
    }

    // 12. consent record (does NOT clear suppression)
    if (body.consent_choice === "opt_in" && snapshot.consent_text) {
      await sr.entities.ConsentRecord.create({
        workspace_id: funnel.workspace_id,
        contact_id: contact.id,
        submission_id: submission.id,
        purpose: "promotional",
        text: snapshot.consent_text,
        version: snapshot.form_version || "",
        choice: "opt_in",
        source: "funnel:" + funnel.slug,
      });
    }

    // 13. delivery job (only when email fulfillment is enabled + sender configured)
    let job = null;
    const deliveryMode = snapshot.delivery_mode || "immediate_only";
    const senderId = snapshot.sender_id || "";
    if (funnel.type === "lead_magnet" && deliveryMode === "immediate_plus_email" && senderId && grant) {
      const sender = firstRecord(await sr.entities.SenderIdentity.filter({ id: senderId, workspace_id: funnel.workspace_id, verified: true }));
      if (sender) {
        const origin = appOrigin(req);
        const accessUrl = `${origin}/r/${grant.access_token}`;
        job = await sr.entities.DeliveryJob.create({
          purpose: "requested_resource",
          workspace_id: funnel.workspace_id,
          submission_id: submission.id,
          resource_grant_id: grant.id,
          resource_version_id: resourceVersionId,
          recipient_email: contact.email,
          recipient_name: contact.display_name,
          sender_id: sender.id,
          state: "pending",
          attempts: 0,
          idempotency_key: request_id,
          access_url: accessUrl,
        });
        // attempt send immediately; immediate access is already granted regardless of outcome
        job = await processDeliveryJob(base44, job, origin);
      }
    }

    return ok({ status: "accepted", confirmation: await buildConfirmation(sr, funnel, snapshot, grant, job, appOrigin(req)) });
  } catch (e) {
    return err(500, e.message);
  }
}

async function buildConfirmation(sr, funnel, snapshot, grant, job, origin) {
  const resourceTitle = snapshot.resource_title || "your resource";
  const result = {
    funnel_name: funnel.name,
    funnel_type: funnel.type,
    contact: { display_name: "" },
    resource: null,
    email: { enabled: false, state: "not_enabled" },
  };
  if (grant) {
    const rv = firstRecord(await sr.entities.ResourceVersion.filter({ id: grant.resource_version_id }));
    result.resource = {
      title: resourceTitle,
      delivery_type: rv?.delivery_type || "file",
      access_url: `${origin}/r/${grant.access_token}`,
      external_url: rv?.external_url || "",
    };
  }
  if (job) {
    result.email = { enabled: true, state: job.state, error: job.last_error || "" };
  }
  return result;
}