// Shared nurture logic: enrollment, dispatch, provider adapter, rendering,
// suppression, unsubscribe tokens, and activation checks.
// Used by captureSubmission (enrollment), nurtureDispatch (sending),
// nurtureWebhook (event handling), nurtureAccess (management), and
// unsubscribeAccess (public unsubscribe).

import { firstRecord, asArray } from "./auth.ts";
import { secrets } from "base44:runtime";

// --- Constants ---
const MIN_DELAY_HOURS = 1; // production minimum; tests use simulated clock
const RESEND_IDEMPOTENCY_WINDOW_HOURS = 24;
const MAX_DISPATCH_BATCH = 10;
const MAX_ATTEMPTS = 3;
const CLAIM_LEASE_SECONDS = 120; // 2 min lease — re-claim if expired

const SUPPORTED_MERGE_FIELDS = [
  "first_name", "last_name", "business_name", "offer_name",
  "booking_url", "resource_title",
];

// --- Helpers ---
export function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function escapeText(s) {
  return String(s || "").replace(/[<>&]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;",
  }[c]));
}

function normalizeEmail(e) {
  return String(e || "").trim().toLowerCase();
}

// --- Merge field rendering ---
// Replaces {{field}} with escaped values. Unknown fields are left as-is
// (validation rejects them before approval, so approved versions never have them).
export function renderMergeFields(text, context) {
  return String(text || "").replace(/\{\{(\w+)\}\}/g, (match, field) => {
    const val = context[field];
    return val != null ? escapeHtml(String(val)) : "";
  });
}

export function renderMergeFieldsText(text, context) {
  return String(text || "").replace(/\{\{(\w+)\}\}/g, (match, field) => {
    const val = context[field];
    return val != null ? String(val) : "";
  });
}

// Find unknown merge fields in a string
export function findUnknownMergeFields(text) {
  const found = new Set();
  const re = /\{\{(\w+)\}\}/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    if (!SUPPORTED_MERGE_FIELDS.includes(m[1])) found.add(m[1]);
  }
  return [...found];
}

// Validate steps: reject unknown merge fields, unsafe URLs, out-of-range step counts
export function validateSteps(steps) {
  const errors = [];
  if (!Array.isArray(steps) || steps.length < 3 || steps.length > 5) {
    errors.push("Sequence must have between 3 and 5 steps");
    return errors;
  }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] || {};
    if (!step.subject || !String(step.subject).trim()) {
      errors.push(`Step ${i + 1}: subject is required`);
    }
    if (!step.body || !String(step.body).trim()) {
      errors.push(`Step ${i + 1}: body is required`);
    }
    const allText = [step.subject, step.preview, step.body, step.cta_label, step.cta_url].join(" ");
    const unknown = findUnknownMergeFields(allText);
    if (unknown.length) errors.push(`Step ${i + 1}: unknown merge field(s): ${unknown.join(", ")}`);
    if (step.cta_url && String(step.cta_url).trim()) {
      const u = String(step.cta_url).trim();
      if (!/^https:\/\//i.test(u)) {
        errors.push(`Step ${i + 1}: CTA URL must start with https://`);
      }
    }
    const delay = Number(step.delay_hours || 0);
    if (i === 0 && delay !== 0) {
      errors.push(`Step 1 delay must be 0 (starts at enrollment)`);
    }
    if (i > 0 && delay < MIN_DELAY_HOURS) {
      errors.push(`Step ${i + 1}: delay must be at least ${MIN_DELAY_HOURS} hour(s)`);
    }
  }
  return errors;
}

// --- Unsubscribe tokens ---
export function generateUnsubscribeToken() {
  return crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
}

export function buildUnsubscribeUrl(origin, token) {
  return `${origin}/u/${token}`;
}

// URL for the List-Unsubscribe header (RFC 8058 one-click).
// Points to the backend function endpoint so email clients can POST directly.
export function buildOneClickUrl(origin, token) {
  return `${origin}/functions/unsubscribeAccess?token=${token}&action=oneClick`;
}

// Ensure a contact has an unsubscribe token (generates one if missing, atomically)
export async function ensureUnsubscribeToken(sr, contact) {
  if (contact.unsubscribe_token) return contact.unsubscribe_token;
  const token = generateUnsubscribeToken();
  await sr.entities.Contact.updateMany(
    { id: contact.id, unsubscribe_token: null },
    { $set: { unsubscribe_token: token } }
  );
  const refreshed = firstRecord(await sr.entities.Contact.filter({ id: contact.id }));
  return refreshed?.unsubscribe_token || token;
}

// --- Suppression ---
// For promotional nurture emails: ALL suppression types block
// (unsubscribe, bounce, complaint, sender_restriction).
// This is stricter than transactional resource delivery, which allows
// through unsubscribe suppressions.
export async function checkPromotionalSuppression(sr, workspaceId, emailNormalized) {
  if (!emailNormalized) return { suppressed: false };
  const suppressions = asArray(
    await sr.entities.Suppression.filter({
      workspace_id: workspaceId,
      email_normalized: emailNormalized,
    })
  );
  if (suppressions.length) {
    return { suppressed: true, reason: suppressions[0].reason };
  }
  return { suppressed: false };
}

// --- Provider configuration ---
export function isProviderConfigured() {
  return !!secrets.get("RESEND_API_KEY");
}

export function isWebhookSecretConfigured() {
  return !!secrets.get("RESEND_WEBHOOK_SECRET");
}

// --- Resend API adapter ---
// Sends via Resend if RESEND_API_KEY is set; falls back to a mock that
// returns a fake message ID so tests and previews work without credentials.
async function sendViaResend({ from, to, subject, html, text, headers, idempotencyKey }) {
  const apiKey = secrets.get("RESEND_API_KEY");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ from, to, subject, html, text, headers }),
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 429) {
    throw { retryable: true, message: "Provider rate limited (429)" };
  }
  if (res.status >= 500) {
    throw { retryable: true, message: `Provider server error (${res.status})` };
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw { retryable: false, message: `Provider error ${res.status}: ${errBody.slice(0, 200)}` };
  }
  const data = await res.json();
  return { messageId: data.id || "", accepted: true, mock: false };
}

function sendViaMock() {
  return {
    messageId: "mock_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16),
    accepted: true,
    mock: true,
  };
}

export async function sendNurtureEmail(payload, opts) {
  // opts.mock forces the mock provider even when Resend is configured (tests).
  if (opts?.mock || !isProviderConfigured()) {
    return sendViaMock();
  }
  return await sendViaResend(payload);
}

// --- Email rendering ---
// Builds the final HTML and plain-text email body with branded header,
// content, CTA, footer with business identity and unsubscribe link.
export function renderEmailHtml(step, context, unsubscribeUrl, businessName, senderEmail) {
  const subject = renderMergeFields(step.subject, context);
  const bodyHtml = renderMergeFields(step.body, context);
  const ctaLabel = renderMergeFields(step.cta_label, context);
  const ctaUrl = renderMergeFields(step.cta_url, context);
  const safeBusiness = escapeHtml(businessName || "the team");
  const safeSender = escapeHtml(senderEmail || "");
  const safeUnsub = escapeHtml(unsubscribeUrl || "");
  const ctaBlock = ctaUrl
    ? `<table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:#0a0a0a;border-radius:6px;">
         <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;font-family:Arial,sans-serif;">${ctaLabel || "Learn more"}</a>
       </td></tr></table>`
    : "";
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td style="padding:18px 28px;">
      <span style="color:#ffffff;font-size:16px;font-weight:bold;letter-spacing:.2px;">${safeBusiness}</span>
    </td></tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:32px 28px;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
        <tr><td>
          ${bodyHtml}
          ${ctaBlock}
        </td></tr>
      </table>
    </td></tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:18px 28px;">
    <tr><td align="center">
      <p style="color:#64748b;font-size:12px;margin:0 0 8px;font-family:Arial,sans-serif;">Sent by ${safeBusiness}${safeSender ? ` &lt;${safeSender}&gt;` : ""}.</p>
      <p style="color:#64748b;font-size:12px;margin:0;font-family:Arial,sans-serif;">
        <a href="${safeUnsub}" style="color:#64748b;text-decoration:underline;">Unsubscribe</a>
      </p>
    </td></tr>
  </table>
</body></html>`;
}

export function renderEmailText(step, context, unsubscribeUrl, businessName) {
  const subject = renderMergeFieldsText(step.subject, context);
  const bodyText = renderMergeFieldsText(step.body, context);
  const ctaLabel = renderMergeFieldsText(step.cta_label, context);
  const ctaUrl = renderMergeFieldsText(step.cta_url, context);
  const ctaBlock = ctaUrl ? `\n${ctaLabel || "Learn more"}: ${ctaUrl}\n` : "";
  return `${subject}

${bodyText}${ctaBlock}
---
Sent by ${businessName || "the team"}.
Unsubscribe: ${unsubscribeUrl}
`;
}

// --- Default 4-email starter ---
export function defaultSteps() {
  return [
    {
      delay_hours: 0,
      subject: "Your first step with {{business_name}}",
      preview: "Here's where to start.",
      body: "<p>Hi {{first_name}},</p><p>Thanks for your interest. Here's a useful first step to get you moving.</p>",
      cta_label: "Get started",
      cta_url: "",
    },
    {
      delay_hours: 48,
      subject: "A common mistake to avoid",
      preview: "Quick tip for you.",
      body: "<p>Hi {{first_name}},</p><p>Here's a tip that catches a lot of people. Avoiding this one thing can save you time.</p>",
      cta_label: "Learn more",
      cta_url: "",
    },
    {
      delay_hours: 48,
      subject: "Addressing a common concern",
      preview: "You might be wondering...",
      body: "<p>Hi {{first_name}},</p><p>A common question is whether this will work for you. Here's our honest take.</p>",
      cta_label: "See if it fits",
      cta_url: "",
    },
    {
      delay_hours: 72,
      subject: "Ready to take the next step?",
      preview: "Book a time that works for you.",
      body: "<p>Hi {{first_name}},</p><p>If you're ready to move forward, pick a time on our calendar and we'll talk through your situation.</p>",
      cta_label: "Book a call",
      cta_url: "{{booking_url}}",
    },
  ];
}

// --- Message identity & idempotency ---
export function computeMessageIdentity(enrollmentId, stepIndex) {
  return `${enrollmentId}::${stepIndex}`;
}

export function computeIdempotencyKey(messageIdentity) {
  return "nurture_" + Buffer.from(messageIdentity).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
}

// Check if a string looks like a valid Base44 record ID (24-char hex).
// Prevents "Invalid query: id is not a valid record ID" errors when
// approved_context fields are missing or set to placeholder values.
function isValidRecordId(id) {
  return typeof id === "string" && /^[a-f0-9]{24}$/i.test(id);
}

// --- Build merge context for a contact ---
export async function buildMergeContext(sr, workspaceId, contact, sequenceVersion) {
  const profile = firstRecord(await sr.entities.BusinessProfile.filter({ workspace_id: workspaceId }));
  const funnelId = sequenceVersion?.approved_context?.funnel_id;
  const funnel = funnelId && isValidRecordId(funnelId)
    ? firstRecord(await sr.entities.Funnel.filter({ id: funnelId }))
    : null;
  const offerId = sequenceVersion?.approved_context?.offer_id;
  const offer = offerId && isValidRecordId(offerId)
    ? firstRecord(await sr.entities.Offer.filter({ id: offerId }))
    : null;
  let resourceTitle = "";
  const rvId = sequenceVersion?.approved_context?.resource_version_id;
  if (rvId && isValidRecordId(rvId)) {
    const rv = firstRecord(await sr.entities.ResourceVersion.filter({ id: rvId }));
    if (rv) {
      const resource = firstRecord(await sr.entities.Resource.filter({ id: rv.resource_id }));
      resourceTitle = resource?.title || "";
    }
  }
  return {
    first_name: contact.first_name || "",
    last_name: contact.last_name || "",
    business_name: profile?.business_name || "",
    offer_name: offer?.name || "",
    booking_url: sequenceVersion?.booking_url || "",
    resource_title: resourceTitle,
  };
}

// --- Enrollment ---
// Called after capture fulfillment. Checks all eligibility rules and
// creates one enrollment + first message if eligible. Returns the reason
// if skipped (for reporting), never throws on skip.
export async function tryEnroll(sr, base44, workspaceId, contactId, funnelId, submissionId, snapshot, origin) {
  const sequenceVersionId = snapshot.nurture_sequence_version_id;
  if (!sequenceVersionId) return { enrolled: false, reason: "no_sequence" };

  const version = firstRecord(
    await sr.entities.NurtureSequenceVersion.filter({ id: sequenceVersionId, workspace_id: workspaceId })
  );
  if (!version) return { enrolled: false, reason: "version_not_found" };

  const sequence = firstRecord(
    await sr.entities.NurtureSequence.filter({ id: version.sequence_id, workspace_id: workspaceId })
  );
  if (!sequence) return { enrolled: false, reason: "sequence_not_found" };
  if (sequence.status !== "active" || !sequence.sending_enabled) {
    return { enrolled: false, reason: "sequence_not_active" };
  }

  const funnel = firstRecord(await sr.entities.Funnel.filter({ id: funnelId }));
  if (!funnel || funnel.state !== "published") {
    return { enrolled: false, reason: "funnel_not_active" };
  }

  const submission = firstRecord(await sr.entities.Submission.filter({ id: submissionId }));
  if (!submission || submission.consent_choice !== "opt_in") {
    return { enrolled: false, reason: "no_consent" };
  }

  const contact = firstRecord(await sr.entities.Contact.filter({ id: contactId }));
  if (!contact) return { enrolled: false, reason: "contact_not_found" };

  // Check booking outcome
  if (contact.booking_outcome === "booked" || contact.booking_outcome === "not_interested") {
    return { enrolled: false, reason: "booking_outcome:" + contact.booking_outcome };
  }

  // Check suppression
  const sup = await checkPromotionalSuppression(sr, workspaceId, contact.email_normalized);
  if (sup.suppressed) return { enrolled: false, reason: "suppressed:" + sup.reason };

  // Check existing enrollment for this contact + sequence (active or paused)
  const existing = asArray(
    await sr.entities.NurtureEnrollment.filter({
      workspace_id: workspaceId,
      contact_id: contactId,
      sequence_id: sequence.id,
      state: { $in: ["active", "paused"] },
    })
  );
  if (existing.length) return { enrolled: false, reason: "already_enrolled" };

  // Check one active promotional enrollment per contact per workspace
  const activePromo = asArray(
    await sr.entities.NurtureEnrollment.filter({
      workspace_id: workspaceId,
      contact_id: contactId,
      state: "active",
    })
  );
  if (activePromo.length) return { enrolled: false, reason: "active_promo_exists" };

  // Ensure unsubscribe token
  const unsubToken = await ensureUnsubscribeToken(sr, contact);

  // Create enrollment
  const runId = crypto.randomUUID();
  const steps = version.steps || [];
  const firstStep = steps[0] || {};
  const now = new Date();
  const delayMs = (Number(firstStep.delay_hours) || 0) * 3600 * 1000;
  const dueAt = new Date(now.getTime() + delayMs);

  const enrollment = await sr.entities.NurtureEnrollment.create({
    workspace_id: workspaceId,
    contact_id: contactId,
    funnel_id: funnelId,
    submission_id: submissionId,
    sequence_id: sequence.id,
    sequence_version_id: version.id,
    run_id: runId,
    current_step: 0,
    next_due_at: dueAt.toISOString(),
    state: "active",
    enrolled_at: now.toISOString(),
  });

  // Build merge context and render first message
  const ctx = await buildMergeContext(sr, workspaceId, contact, version);
  const sender = firstRecord(await sr.entities.SenderIdentity.filter({ id: version.sender_id, workspace_id: workspaceId }));
  const senderEmail = sender?.email || "";
  const businessName = ctx.business_name || sender?.from_name || "";
  const unsubUrl = buildUnsubscribeUrl(origin, unsubToken);

  const messageIdentity = computeMessageIdentity(enrollment.id, 0);
  const idempotencyKey = computeIdempotencyKey(messageIdentity);

  await sr.entities.NurtureMessage.create({
    workspace_id: workspaceId,
    enrollment_id: enrollment.id,
    step_index: 0,
    message_identity: messageIdentity,
    recipient_email: contact.email,
    recipient_name: contact.display_name || contact.first_name || "",
    subject: renderMergeFields(firstStep.subject, ctx),
    body_html: renderEmailHtml(firstStep, ctx, unsubUrl, businessName, senderEmail),
    body_text: renderEmailText(firstStep, ctx, unsubUrl, businessName),
    cta_label: renderMergeFields(firstStep.cta_label, ctx),
    cta_url: renderMergeFields(firstStep.cta_url, ctx),
    due_at: dueAt.toISOString(),
    attempts: 0,
    outcome: "queued",
    idempotency_key: idempotencyKey,
  });

  return { enrolled: true, enrollment_id: enrollment.id };
}

// --- Dispatch: process due messages ---
// Called by the scheduled workflow. Finds due queued messages, claims each
// atomically, rechecks eligibility, sends via provider, and schedules next step.
export async function dispatchDueMessages(sr, origin, opts) {
  const now = new Date();
  const mock = opts?.mock || !isProviderConfigured();
  const batch = opts?.batch || MAX_DISPATCH_BATCH;
  const results = [];

  // Find due queued messages across all workspaces, sorted by due_at
  const due = asArray(
    await sr.entities.NurtureMessage.filter(
      { outcome: "queued", due_at: { $lte: now.toISOString() } },
      { sort: "due_at", limit: batch }
    )
  );

  for (const msg of due) {
    try {
      const r = await processOneMessage(sr, msg, origin, mock, now);
      results.push(r);
    } catch (e) {
      results.push({ id: msg.id, error: String(e?.message || e) });
    }
  }
  return { processed: results.length, results };
}

async function processOneMessage(sr, msg, origin, mock, now) {
  // Re-fetch latest state
  const fresh = firstRecord(await sr.entities.NurtureMessage.filter({ id: msg.id }));
  if (!fresh) return { id: msg.id, skipped: "not_found" };
  msg = fresh;

  // Skip if no longer queued
  if (msg.outcome !== "queued") return { id: msg.id, skipped: "not_queued:" + msg.outcome };

  // Enforce max attempts
  if ((msg.attempts || 0) >= MAX_ATTEMPTS) {
    await sr.entities.NurtureMessage.update(msg.id, {
      outcome: "permanently_failed",
      last_error: "Max attempts reached",
    });
    return { id: msg.id, skipped: "max_attempts" };
  }

  // Load enrollment and recheck eligibility
  const enrollment = firstRecord(await sr.entities.NurtureEnrollment.filter({ id: msg.enrollment_id }));
  if (!enrollment || enrollment.state !== "active") {
    await sr.entities.NurtureMessage.update(msg.id, {
      outcome: "suppressed",
      last_error: "Enrollment not active: " + (enrollment?.state || "missing"),
    });
    return { id: msg.id, skipped: "enrollment_inactive" };
  }

  // Load sequence + version for pause/sender checks
  const sequence = firstRecord(await sr.entities.NurtureSequence.filter({ id: enrollment.sequence_id }));
  if (!sequence || sequence.status !== "active" || !sequence.sending_enabled) {
    await sr.entities.NurtureMessage.update(msg.id, {
      outcome: "suppressed",
      last_error: "Sequence not active or sending disabled",
    });
    return { id: msg.id, skipped: "sequence_inactive" };
  }

  const version = firstRecord(await sr.entities.NurtureSequenceVersion.filter({ id: enrollment.sequence_version_id }));
  if (!version) {
    await sr.entities.NurtureMessage.update(msg.id, {
      outcome: "permanently_failed",
      last_error: "Sequence version not found",
    });
    return { id: msg.id, skipped: "version_missing" };
  }

  // Check suppression immediately before send
  const contact = firstRecord(await sr.entities.Contact.filter({ id: enrollment.contact_id }));
  if (!contact) {
    await sr.entities.NurtureMessage.update(msg.id, {
      outcome: "permanently_failed",
      last_error: "Contact not found",
    });
    return { id: msg.id, skipped: "contact_missing" };
  }

  const sup = await checkPromotionalSuppression(sr, enrollment.workspace_id, contact.email_normalized);
  if (sup.suppressed) {
    await sr.entities.NurtureMessage.update(msg.id, {
      outcome: "suppressed",
      last_error: "Recipient suppressed: " + sup.reason,
    });
    await stopEnrollment(sr, enrollment, "suppressed:" + sup.reason, "system");
    return { id: msg.id, skipped: "suppressed" };
  }

  // Check booking outcome
  if (contact.booking_outcome) {
    await sr.entities.NurtureMessage.update(msg.id, {
      outcome: "suppressed",
      last_error: "Booking outcome: " + contact.booking_outcome,
    });
    await stopEnrollment(sr, enrollment, "booking:" + contact.booking_outcome, "system");
    return { id: msg.id, skipped: "booking_outcome" };
  }

  // Check sender
  const sender = firstRecord(await sr.entities.SenderIdentity.filter({ id: version.sender_id, workspace_id: enrollment.workspace_id }));
  if (!sender) {
    await sr.entities.NurtureMessage.update(msg.id, {
      outcome: "permanently_failed",
      last_error: "Sender not found",
    });
    return { id: msg.id, skipped: "sender_missing" };
  }

  // Atomically claim: only if still queued
  const leaseExpiry = new Date(now.getTime() + CLAIM_LEASE_SECONDS * 1000);
  const claim = await sr.entities.NurtureMessage.updateMany(
    { id: msg.id, outcome: "queued" },
    {
      $set: { outcome: "processing", claim_lease_expires_at: leaseExpiry.toISOString() },
      $inc: { attempts: 1 },
    }
  );
  if (!claim.updated) {
    return { id: msg.id, skipped: "claim_lost" };
  }

  // Set first_attempt_at if this is the first attempt
  const freshAfterClaim = firstRecord(await sr.entities.NurtureMessage.filter({ id: msg.id }));
  const firstAttemptAt = freshAfterClaim?.first_attempt_at || now.toISOString();
  if (!freshAfterClaim?.first_attempt_at) {
    await sr.entities.NurtureMessage.update(msg.id, { first_attempt_at: firstAttemptAt });
  }

  // Build unsubscribe URL
  const unsubToken = await ensureUnsubscribeToken(sr, contact);
  const unsubUrl = buildUnsubscribeUrl(origin, unsubToken);

  // Build headers for RFC 8058 one-click unsubscribe.
  // List-Unsubscribe points to the function endpoint so email clients can
  // POST directly; the footer link goes to the confirmation page.
  const oneClickUrl = buildOneClickUrl(origin, unsubToken);
  const emailHeaders = {
    "List-Unsubscribe": `<${oneClickUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };

  const fromAddr = isProviderConfigured() ? sender.email : "";

  try {
    const result = await sendNurtureEmail({
      from: fromAddr ? `${sender.from_name || ""} <${fromAddr}>` : sender.from_name || "",
      to: msg.recipient_email,
      subject: msg.subject,
      html: msg.body_html,
      text: msg.body_text,
      headers: emailHeaders,
      idempotencyKey: msg.idempotency_key,
    }, { mock });

    const messageId = result.messageId || "";
    const sentAt = new Date().toISOString();

    await sr.entities.NurtureMessage.update(msg.id, {
      outcome: "provider_accepted",
      provider_message_id: String(messageId),
      sent_at: sentAt,
      last_attempt_at: sentAt,
      last_error: "",
    });

    // Schedule next step from the actual accepted-send timestamp
    await scheduleNextStep(sr, enrollment, version, msg.step_index, sentAt, origin, contact, unsubToken);

    return { id: msg.id, sent: true, mock: result.mock, message_id: messageId };
  } catch (e) {
    const errMsg = String(e?.message || e);
    const retryable = e?.retryable || /timeout|network|connection|econnreset|aborted|socket/i.test(errMsg);
    const now_iso = new Date().toISOString();

    // Check if we're outside the idempotency window
    const firstAttemptMs = firstAttemptAt ? new Date(firstAttemptAt).getTime() : now.getTime();
    const windowMs = RESEND_IDEMPOTENCY_WINDOW_HOURS * 3600 * 1000;
    const outsideWindow = (now.getTime() - firstAttemptMs) > windowMs;

    if (outsideWindow && retryable) {
      // Unknown outcome outside the provider window → reconciliation
      await sr.entities.NurtureMessage.update(msg.id, {
        outcome: "needs_reconciliation",
        last_error: `Uncertain outcome outside idempotency window: ${errMsg}`,
        last_attempt_at: now_iso,
      });
      return { id: msg.id, needs_reconciliation: true };
    }

    await sr.entities.NurtureMessage.update(msg.id, {
      outcome: retryable ? "retryable_failure" : "permanently_failed",
      last_error: errMsg,
      last_attempt_at: now_iso,
    });

    return { id: msg.id, sent: false, retryable, error: errMsg };
  }
}

// Schedule the next step from the actual accepted-send timestamp.
// Does NOT catch up missed steps — only the next eligible step is scheduled.
async function scheduleNextStep(sr, enrollment, version, currentStepIndex, acceptedAt, origin, contact, unsubToken) {
  const steps = version.steps || [];
  const nextIndex = currentStepIndex + 1;
  if (nextIndex >= steps.length) {
    // Sequence complete
    await sr.entities.NurtureEnrollment.update(enrollment.id, {
      state: "completed",
      completed_at: new Date().toISOString(),
      current_step: currentStepIndex,
    });
    return;
  }

  const nextStep = steps[nextIndex];
  const delayMs = (Number(nextStep.delay_hours) || MIN_DELAY_HOURS) * 3600 * 1000;
  const dueAt = new Date(new Date(acceptedAt).getTime() + delayMs);

  const ctx = await buildMergeContext(sr, enrollment.workspace_id, contact, version);
  const sender = firstRecord(await sr.entities.SenderIdentity.filter({ id: version.sender_id, workspace_id: enrollment.workspace_id }));
  const businessName = ctx.business_name || sender?.from_name || "";
  const unsubUrl = buildUnsubscribeUrl(origin, unsubToken || contact.unsubscribe_token || "");

  const messageIdentity = computeMessageIdentity(enrollment.id, nextIndex);
  const idempotencyKey = computeIdempotencyKey(messageIdentity);

  // Check if message already exists (idempotent)
  const existing = firstRecord(await sr.entities.NurtureMessage.filter({ enrollment_id: enrollment.id, step_index: nextIndex }));
  if (existing) return;

  await sr.entities.NurtureMessage.create({
    workspace_id: enrollment.workspace_id,
    enrollment_id: enrollment.id,
    step_index: nextIndex,
    message_identity: messageIdentity,
    recipient_email: contact.email,
    recipient_name: contact.display_name || contact.first_name || "",
    subject: renderMergeFields(nextStep.subject, ctx),
    body_html: renderEmailHtml(nextStep, ctx, unsubUrl, businessName, sender?.email || ""),
    body_text: renderEmailText(nextStep, ctx, unsubUrl, businessName),
    cta_label: renderMergeFields(nextStep.cta_label, ctx),
    cta_url: renderMergeFields(nextStep.cta_url, ctx),
    due_at: dueAt.toISOString(),
    attempts: 0,
    outcome: "queued",
    idempotency_key: idempotencyKey,
  });

  await sr.entities.NurtureEnrollment.update(enrollment.id, {
    current_step: nextIndex,
    next_due_at: dueAt.toISOString(),
  });
}

// Stop an enrollment: cancel remaining steps, record stop reason
export async function stopEnrollment(sr, enrollment, reason, actor) {
  if (enrollment.state === "completed" || enrollment.state === "stopped" || enrollment.state === "suppressed") {
    // Already terminal — don't restart or rewrite
    return;
  }
  await sr.entities.NurtureEnrollment.update(enrollment.id, {
    state: reason.startsWith("suppressed") ? "suppressed" : "stopped",
    stop_reason: reason,
    stopped_by: actor,
    stopped_at: new Date().toISOString(),
  });
  // Cancel remaining queued messages
  await sr.entities.NurtureMessage.updateMany(
    { enrollment_id: enrollment.id, outcome: "queued" },
    { $set: { outcome: "suppressed", last_error: "Enrollment stopped: " + reason } }
  );
}

// Stop all active enrollments for a contact in a workspace (used by unsubscribe, mark booked)
export async function stopAllEnrollments(sr, workspaceId, contactId, reason, actor) {
  const enrollments = asArray(
    await sr.entities.NurtureEnrollment.filter({
      workspace_id: workspaceId,
      contact_id: contactId,
      state: { $in: ["active", "paused"] },
    })
  );
  for (const e of enrollments) {
    await stopEnrollment(sr, e, reason, actor);
  }
  return enrollments.length;
}

// --- Activation checks ---
// Returns { ok: boolean, blockers: string[] } for activating a sequence.
export async function checkActivation(sr, workspaceId, sequence, version) {
  const blockers = [];

  if (!version) {
    blockers.push("No approved version — Review the sequence first");
    return { ok: false, blockers };
  }

  // Content validation
  const stepErrors = validateSteps(version.steps);
  if (stepErrors.length) blockers.push(...stepErrors);

  // Sender
  if (!version.sender_id) {
    blockers.push("No sender selected");
  } else {
    const sender = firstRecord(await sr.entities.SenderIdentity.filter({ id: version.sender_id, workspace_id: workspaceId }));
    if (!sender) blockers.push("Selected sender not found");
  }

  // Booking URL for the final step CTA
  const lastStep = version.steps?.[version.steps?.length - 1];
  if (lastStep?.cta_url === "{{booking_url}}" && !version.booking_url) {
    blockers.push("Last step uses {{booking_url}} but no booking URL is set");
  }

  // Provider readiness
  if (!isProviderConfigured()) {
    blockers.push("Email provider (Resend) is not configured — live sending is blocked. You can still preview and test with the mock provider.");
  }

  // Webhook secret for delivery tracking
  if (!isWebhookSecretConfigured()) {
    blockers.push("Resend webhook secret is not configured — delivery tracking will be limited.");
  }

  return { ok: blockers.length === 0, blockers };
}

// --- Webhook signature verification (Svix/Resend) ---
// Resend uses Svix for webhook signing. We verify manually using Web Crypto.
export async function verifyWebhookSignature(rawBody, signatureHeader, timestamp, msgId, secret) {
  if (!signatureHeader || !timestamp || !msgId) return false;
  const signingSecret = secret.replace(/^whsec_/, "");
  const signedPayload = `${msgId}.${timestamp}.${rawBody}`;
  const expectedSigs = signatureHeader.split(" ").map((s) => {
    const [prefix, sig] = s.split(",");
    if (prefix !== "v1") return null;
    return sig;
  }).filter(Boolean);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const computedSig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));

  // Check timestamp freshness (5 min tolerance)
  const ageMs = Date.now() - Number(timestamp) * 1000;
  if (Math.abs(ageMs) > 5 * 60 * 1000) return false;

  return expectedSigs.includes(computedSig);
}

// --- Process webhook event ---
// Deduplicates by provider_event_id, maps to message, updates outcome.
// Hard bounces and complaints create suppression + stop enrollments.
export async function processProviderEvent(sr, event) {
  const providerEventId = String(event.event_id || "");
  if (!providerEventId) return { skipped: "no_event_id" };

  // Deduplicate
  const existing = firstRecord(
    await sr.entities.ProviderEvent.filter({ provider_event_id: providerEventId })
  );
  if (existing) return { skipped: "duplicate" };

  const messageId = String(event.message_id || "");
  const eventType = String(event.event_type || "");
  const workspaceId = String(event.workspace_id || "");

  // Find the nurture message by provider_message_id
  const msg = firstRecord(
    await sr.entities.NurtureMessage.filter({ provider_message_id: messageId })
  );

  const providerEvent = await sr.entities.ProviderEvent.create({
    workspace_id: workspaceId || msg?.workspace_id || "",
    provider: "resend",
    provider_event_id: providerEventId,
    message_id: messageId,
    nurture_message_id: msg?.id || "",
    event_type: eventType,
    result: String(event.result || ""),
    processed_at: new Date().toISOString(),
  });

  if (!msg) return { logged: true, no_message: true };

  // Update message outcome based on event type
  // Out-of-order: a newer terminal outcome must not be reversed by an older event
  const terminalOutcomes = ["delivered", "permanently_failed", "suppressed"];
  const isTerminal = terminalOutcomes.includes(msg.outcome);

  if (eventType === "delivered" && !isTerminal) {
    await sr.entities.NurtureMessage.update(msg.id, { outcome: "delivered" });
  } else if (eventType === "bounced" || eventType === "complaint") {
    // Hard bounce or complaint → suppress + stop enrollments
    // Find contact by the message's enrollment
    const enrollment = firstRecord(await sr.entities.NurtureEnrollment.filter({ id: msg.enrollment_id }));
    if (enrollment) {
      const contact = firstRecord(await sr.entities.Contact.filter({ id: enrollment.contact_id }));
      if (contact) {
        await sr.entities.Suppression.create({
          workspace_id: enrollment.workspace_id,
          contact_id: contact.id,
          email_normalized: contact.email_normalized,
          reason: eventType === "bounced" ? "bounce" : "complaint",
          source: "provider_webhook",
        });
        await stopAllEnrollments(sr, enrollment.workspace_id, contact.id, eventType, "system");
      }
    }
    await sr.entities.NurtureMessage.update(msg.id, {
      outcome: "suppressed",
      last_error: `${eventType} reported by provider`,
    });
  } else if (eventType === "delivery_delayed" && !isTerminal) {
    // Non-terminal, just log
  }

  return { logged: true, event_id: providerEvent.id };
}

// --- Reporting ---
export async function getWorkspaceMetrics(sr, workspaceId) {
  const [
    eligibleCount, enrolledCount, skippedCount,
    activeCount, completedCount, stoppedCount,
    acceptedCount, deliveredCount, failedCount,
    unsubscribeCount, bookedCount,
  ] = await Promise.all([
    // Eligible: contacts with opt-in consent and no suppression or booking outcome
    // (approximation: count contacts with at least one opt-in consent record)
    sr.entities.ConsentRecord.count({ workspace_id: workspaceId, choice: "opt_in" }),
    sr.entities.NurtureEnrollment.count({ workspace_id: workspaceId }),
    sr.entities.NurtureEnrollment.count({ workspace_id: workspaceId, state: "stopped" }),
    sr.entities.NurtureEnrollment.count({ workspace_id: workspaceId, state: "active" }),
    sr.entities.NurtureEnrollment.count({ workspace_id: workspaceId, state: "completed" }),
    sr.entities.NurtureEnrollment.count({ workspace_id: workspaceId, state: { $in: ["stopped", "suppressed"] } }),
    sr.entities.NurtureMessage.count({ workspace_id: workspaceId, outcome: { $in: ["provider_accepted", "delivered"] } }),
    sr.entities.NurtureMessage.count({ workspace_id: workspaceId, outcome: "delivered" }),
    sr.entities.NurtureMessage.count({ workspace_id: workspaceId, outcome: { $in: ["retryable_failure", "permanently_failed"] } }),
    sr.entities.Suppression.count({ workspace_id: workspaceId, reason: "unsubscribe" }),
    sr.entities.Contact.count({ workspace_id: workspaceId, booking_outcome: "booked" }),
  ]);

  return {
    eligible_leads: eligibleCount,
    enrolled_leads: enrolledCount,
    skipped_enrollments: skippedCount,
    active_sequences: activeCount,
    completed_sequences: completedCount,
    stopped_sequences: stoppedCount,
    provider_accepted_emails: acceptedCount,
    confirmed_deliveries: deliveredCount,
    failures_bounces: failedCount,
    unsubscribes: unsubscribeCount,
    staff_marked_bookings: bookedCount,
  };
}