import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { firstRecord, asArray, ok, err, computeFingerprint, dedupKeepOldest } from "../../shared/auth.ts";
import { processDeliveryJob } from "../../shared/delivery.ts";

// Public, anonymous form capture. No auth. Resolves the funnel from its
// immutable public_id + a client-supplied published_version_id binding, validates
// the form, and creates contact + lead + submission + grant (+ delivery job)
// with request-id idempotency, payload-fingerprint conflict detection, and
// recovery of missing downstream work after failures.

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

    const publicId = String(body.public_id || "").trim();
    if (!publicId) return err(400, "Missing funnel");

    const requestId = String(body.request_id || "").trim();
    if (!requestId) return err(400, "Missing request identifier");

    // 1. resolve published funnel by immutable public_id (global uniqueness)
    const funnel = firstRecord(
      await sr.entities.Funnel.filter({ public_id: publicId, state: "published" })
    );
    if (!funnel) return err(404, "This funnel is not accepting submissions right now");

    // 2. published-version binding (client must send the version it rendered)
    const publishedVersionId = String(body.published_version_id || "").trim();
    if (!publishedVersionId) return err(400, "Missing published version");

    const version = firstRecord(
      await sr.entities.PublishedFunnelVersion.filter({ id: publishedVersionId, funnel_id: funnel.id })
    );
    if (!version) return err(404, "This funnel version is no longer available");

    const snapshot = version.snapshot || {};
    const { fields, form_version } = deriveForm(snapshot);
    if (!fields.length) return err(400, "This funnel has no form configured");

    // 3. stale form version check (client echo must match the bound version)
    if (body.form_version && body.form_version !== form_version) {
      return Response.json(
        { error: "This page has been updated. Please review the current form and resubmit.", stale: true },
        { status: 409 }
      );
    }

    const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
    const allowed = new Set(fields.map((f) => f.name));
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

    // 5. compute payload fingerprint (same ID + same payload = retry; same ID + different = conflict)
    const payloadFingerprint = computeFingerprint({
      answers,
      form_version,
      consent_choice: body.consent_choice === "opt_in" ? "opt_in" : (snapshot.consent_text ? "opt_out" : "not_offered"),
      published_version_id: publishedVersionId,
    });

    // 6. rate limit: max RATE_LIMIT_PER_MIN submissions per (funnel, email) per minute
    const since = new Date(Date.now() - 60 * 1000).toISOString();
    const recentCount = await sr.entities.Submission.count({
      funnel_id: funnel.id,
      email_normalized: emailNorm,
      request_id: { $ne: requestId },
      accepted_at: { $gte: since },
    });
    if (recentCount >= RATE_LIMIT_PER_MIN) {
      return err(429, "Too many submissions. Please wait a moment and try again.");
    }

    // 7. atomic submission claim: upsert by (funnel_id, request_id)
    // NOTE: Base44 upsert can create duplicates under concurrency (no unique
    // constraints). We follow with a dedup pass that keeps the oldest record.
    await sr.entities.Submission.upsert(
      [{ funnel_id: funnel.id, request_id: requestId, workspace_id: funnel.workspace_id }],
      { key: ["funnel_id", "request_id"] }
    );

    // Dedup: keep oldest, delete any concurrent duplicates
    let submission = await dedupKeepOldest(sr, "Submission", { funnel_id: funnel.id, request_id: requestId });

    // 8. check if already enriched (has payload_fingerprint)
    if (submission?.payload_fingerprint) {
      // Existing submission — compare fingerprint
      if (submission.payload_fingerprint !== payloadFingerprint) {
        return Response.json(
          { error: "This request was already submitted with different data.", conflict: true },
          { status: 409 }
        );
      }
      // Same fingerprint — resume/recover downstream using the ORIGINAL bound version
      return ok({
        status: "accepted",
        existing: true,
        confirmation: await fulfill(sr, base44, funnel, submission, appOrigin(req)),
      });
    }

    // 9. new submission — the bound version must be the currently active one
    if (funnel.active_version_id !== publishedVersionId) {
      // Funnel was republished since the client loaded the form → stale.
      // Clean up the unenriched claim (only if still unenriched).
      await sr.entities.Submission.updateMany(
        { id: submission.id, payload_fingerprint: null },
        { $unset: { placeholder: "" } }
      );
      // Delete the unenriched placeholder so a fresh request_id can proceed after reload
      const stillEmpty = firstRecord(await sr.entities.Submission.filter({ id: submission.id }));
      if (stillEmpty && !stillEmpty.payload_fingerprint) {
        try { await sr.entities.Submission.delete(submission.id); } catch {}
      }
      return Response.json(
        { error: "This page has been updated. Please reload and resubmit the current form.", stale: true },
        { status: 409 }
      );
    }

    // 10. atomically enrich the submission (only if not already enriched by a concurrent request)
    await sr.entities.Submission.updateMany(
      { id: submission.id, payload_fingerprint: null },
      {
        $set: {
          workspace_id: funnel.workspace_id,
          contact_id: "",
          funnel_lead_id: "",
          published_version_id: publishedVersionId,
          form_version,
          answers,
          email_normalized: emailNorm,
          accepted_at: new Date().toISOString(),
          processing_state: "accepted",
          source: body.source ? String(body.source) : "",
          campaign: body.campaign ? String(body.campaign) : "",
          resource_version_id: snapshot.resource_version_id || "",
          consent_text: snapshot.consent_text || "",
          consent_version: snapshot.form_version || "",
          consent_choice: body.consent_choice === "opt_in" ? "opt_in" : (snapshot.consent_text ? "opt_out" : "not_offered"),
          payload_fingerprint: payloadFingerprint,
        },
      }
    );

    // Re-fetch to see who won the enrichment race
    submission = firstRecord(await sr.entities.Submission.filter({ id: submission.id }));
    if (submission?.payload_fingerprint && submission.payload_fingerprint !== payloadFingerprint) {
      // A concurrent request with different data enriched first → conflict
      return Response.json(
        { error: "This request was already submitted with different data.", conflict: true },
        { status: 409 }
      );
    }

    // 11. fulfill: contact + lead + grant + consent + job (all idempotent)
    return ok({
      status: "accepted",
      confirmation: await fulfill(sr, base44, funnel, submission, appOrigin(req)),
    });
  } catch (e) {
    return err(500, e.message);
  }
}

// Fulfillment + recovery: resolves contact, lead, grant, consent, and job.
// Every step is idempotent — checks for existing records before creating.
// Uses the submission's bound published_version_id for the snapshot, so
// recovery after a republish preserves the original resource and consent.
async function fulfill(sr, base44, funnel, submission, origin) {
  // Resolve the bound version (original accepted version, even if republished since)
  const boundVersionId = submission.published_version_id;
  const boundVersion = firstRecord(await sr.entities.PublishedFunnelVersion.filter({ id: boundVersionId }));
  const snapshot = boundVersion?.snapshot || {};
  const now = new Date().toISOString();

  // Resolve the email from the submission's answers
  const answers = submission.answers || {};
  const emailNorm = submission.email_normalized || normalizeEmail(answers.email || "");
  const emailRaw = answers.email || emailNorm;
  const nameFull = String(answers.name || "").trim();
  const { first_name, last_name } = splitName(nameFull);
  const display_name = nameFull || emailNorm;

  // --- Contact: upsert + dedup + fill missing ---
  await sr.entities.Contact.upsert(
    [{
      workspace_id: funnel.workspace_id,
      email_normalized: emailNorm,
      email: emailRaw,
      source: "funnel:" + funnel.slug,
      first_known_source: "funnel:" + funnel.slug,
      tags: [],
    }],
    { key: ["workspace_id", "email_normalized"] }
  );
  let contact = await dedupKeepOldest(sr, "Contact", { workspace_id: funnel.workspace_id, email_normalized: emailNorm }, async (dupId, survivorId) => {
    await sr.entities.Submission.updateMany({ contact_id: dupId }, { $set: { contact_id: survivorId } });
    await sr.entities.FunnelLead.updateMany({ contact_id: dupId }, { $set: { contact_id: survivorId } });
    await sr.entities.ConsentRecord.updateMany({ contact_id: dupId }, { $set: { contact_id: survivorId } });
  });
  // Fill in missing display fields (never overwrite existing)
  const contactUpd = {};
  if (first_name && !contact.first_name) contactUpd.first_name = first_name;
  if (last_name && !contact.last_name) contactUpd.last_name = last_name;
  if (display_name && !contact.display_name) contactUpd.display_name = display_name;
  if (answers.company && !contact.company) contactUpd.company = String(answers.company);
  if (answers.phone && !contact.phone) contactUpd.phone = String(answers.phone);
  if (Object.keys(contactUpd).length) {
    contact = await sr.entities.Contact.update(contact.id, contactUpd);
  }

  // --- Lead: upsert + dedup + set first_submission_id if new ---
  await sr.entities.FunnelLead.upsert(
    [{
      workspace_id: funnel.workspace_id,
      funnel_id: funnel.id,
      contact_id: contact.id,
      latest_submission_id: submission.id,
      last_seen_at: now,
    }],
    { key: ["funnel_id", "contact_id"] }
  );
  let lead = await dedupKeepOldest(sr, "FunnelLead", { funnel_id: funnel.id, contact_id: contact.id }, async (dupId, survivorId) => {
    await sr.entities.Submission.updateMany({ funnel_lead_id: dupId }, { $set: { funnel_lead_id: survivorId } });
  });
  // Set first_submission_id only on create (atomic conditional)
  await sr.entities.FunnelLead.updateMany(
    { id: lead.id, first_submission_id: null },
    {
      $set: {
        first_submission_id: submission.id,
        first_seen_at: now,
        acquisition_source: submission.source || "",
        acquisition_campaign: submission.campaign || "",
      },
    }
  );
  lead = firstRecord(await sr.entities.FunnelLead.filter({ id: lead.id }));

  // Update submission with contact_id and funnel_lead_id if missing
  const subUpd = {};
  if (!submission.contact_id) subUpd.contact_id = contact.id;
  if (!submission.funnel_lead_id && lead?.id) subUpd.funnel_lead_id = lead.id;
  if (Object.keys(subUpd).length) {
    submission = await sr.entities.Submission.update(submission.id, subUpd);
  }

  // --- Grant: idempotent (check existence before creating) ---
  let grant = firstRecord(await sr.entities.ResourceGrant.filter({ submission_id: submission.id }));
  if (!grant && funnel.type === "lead_magnet" && snapshot.resource_version_id) {
    const rv = firstRecord(await sr.entities.ResourceVersion.filter({ id: snapshot.resource_version_id }));
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

  // --- Consent: idempotent ---
  if (submission.consent_choice === "opt_in" && snapshot.consent_text) {
    const existingConsent = firstRecord(
      await sr.entities.ConsentRecord.filter({ submission_id: submission.id, choice: "opt_in" })
    );
    if (!existingConsent) {
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
  }

  // --- Delivery job: idempotent ---
  let job = firstRecord(await sr.entities.DeliveryJob.filter({ submission_id: submission.id }));
  const deliveryMode = snapshot.delivery_mode || "immediate_only";
  const senderId = snapshot.sender_id || "";
  if (!job && funnel.type === "lead_magnet" && deliveryMode === "immediate_plus_email" && senderId && grant) {
    const sender = firstRecord(
      await sr.entities.SenderIdentity.filter({ id: senderId, workspace_id: funnel.workspace_id })
    );
    if (sender) {
      const accessUrl = `${origin}/r/${grant.access_token}`;
      job = await sr.entities.DeliveryJob.create({
        purpose: "requested_resource",
        workspace_id: funnel.workspace_id,
        submission_id: submission.id,
        resource_grant_id: grant.id,
        resource_version_id: snapshot.resource_version_id || "",
        recipient_email: contact.email,
        recipient_name: contact.display_name,
        sender_id: sender.id,
        state: "pending",
        attempts: 0,
        idempotency_key: submission.request_id,
        access_url: accessUrl,
      });
      job = await processDeliveryJob(base44, job, origin);
    }
  }

  // Mark fulfilled
  await sr.entities.Submission.update(submission.id, { processing_state: "fulfilled" });

  return buildConfirmation(sr, funnel, snapshot, grant, job, origin);
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