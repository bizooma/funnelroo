// Shared delivery logic for requested-resource emails.
// Used by captureSubmission (immediate send after acceptance) and
// senderAccess (manual retry / reconciliation).
//
// Provider: the platform Core.SendEmail integration is the interim provider.
// It sends from the app's own platform address — NOT the customer's sender
// email. The sender's from_name is used as the display name; sender.email and
// sender.reply_to are NOT used by the platform provider (it does not accept
// a custom from or reply-to). An external email provider adapter can be
// added here when configured; until then isExternalProviderConfigured() is
// false and senders are not domain-verified.

import { firstRecord, asArray } from "./auth.ts";

const MAX_ATTEMPTS = 3;

// --- Provider adapter ---
// When an external provider (Resend, SendGrid, etc.) is configured via
// workspace secrets, this is where the adapter would branch. For now the
// platform SendEmail is the only provider, and it does NOT verify customer
// domains or accept a custom from/reply-to.
export function isExternalProviderConfigured() {
  return false;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function brandedEmail({ resourceTitle, businessName, recipientName, accessUrl }) {
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : `Hi,`;
  const safeBusiness = escapeHtml(businessName || "the team");
  const safeTitle = escapeHtml(resourceTitle);
  const safeUrl = escapeHtml(accessUrl);
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td style="padding:18px 28px;">
      <span style="color:#ffffff;font-size:16px;font-weight:bold;letter-spacing:.2px;">FunnelRoo</span>
      <span style="color:#9ca3af;font-size:12px;margin-left:8px;">via ${safeBusiness}</span>
    </td></tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:32px 28px;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
        <tr><td>
          <h1 style="color:#0a0a0a;font-size:22px;margin:0 0 12px;font-family:Arial,Arial,sans-serif;">Your ${safeTitle} is ready</h1>
          <p style="color:#0a0a0a;font-size:15px;line-height:1.6;margin:0 0 16px;">${greeting}</p>
          <p style="color:#0a0a0a;font-size:15px;line-height:1.6;margin:0 0 24px;">Thanks for requesting <strong>${safeTitle}</strong>. You can access it any time using the button below.</p>
          <table cellpadding="0" cellspacing="0"><tr><td style="background:#0a0a0a;border-radius:6px;">
            <a href="${safeUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;font-family:Arial,Arial,sans-serif;">Access your resource</a>
          </td></tr></table>
          <p style="color:#64748b;font-size:13px;line-height:1.5;margin:24px 0 0;">If the button doesn't work, copy this link into your browser:<br/><span style="word-break:break-all;">${safeUrl}</span></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:18px 28px;">
    <tr><td align="center">
      <p style="color:#64748b;font-size:12px;margin:0;font-family:Arial,Arial,sans-serif;">Sent by ${safeBusiness} via FunnelRoo. This link grants access to the resource you requested.</p>
    </td></tr>
  </table>
</body></html>`;
}

// Check suppression data before sending. Requested-resource emails are
// transactional: bounce/complaint/sender_restriction suppressions block them,
// but unsubscribe (promotional opt-out) does not.
// Returns { suppressed: true, reason } or { suppressed: false }.
async function checkSuppression(sr, workspaceId, emailNormalized) {
  if (!emailNormalized) return { suppressed: false };
  const suppressions = asArray(
    await sr.entities.Suppression.filter({ workspace_id: workspaceId, email_normalized: emailNormalized })
  );
  for (const s of suppressions) {
    if (s.reason === "bounce" || s.reason === "complaint" || s.reason === "sender_restriction") {
      return { suppressed: true, reason: s.reason };
    }
    // unsubscribe → promotional only; requested-resource is transactional, so allow
  }
  return { suppressed: false };
}

// Process a single DeliveryJob: resolve context, check suppression, claim
// atomically, send, update state. Returns the updated job.
//
// Durability:
// - Re-fetches the job to get the latest state (avoids stale data).
// - Skips if already terminal (provider_accepted, delivered, suppressed).
// - Enforces MAX_ATTEMPTS independently of state (never retries exhausted jobs
//   even if state is manually reset to pending).
// - Checks suppression before every send (a suppressed recipient stays suppressed
//   even if the job state is reset).
// - Atomically claims via updateMany (concurrent processors can't both send).
// - Distinguishes uncertain outcomes (network/timeout) from known failures.
// - provider_accepted != delivered: acceptance means the provider took the
//   request, not that the recipient's inbox received it.
export async function processDeliveryJob(base44, job, origin) {
  const sr = base44.asServiceRole;

  // Re-fetch to get the latest state
  const fresh = firstRecord(await sr.entities.DeliveryJob.filter({ id: job.id }));
  if (fresh) job = fresh;

  // Terminal/active states — skip. "processing" means another processor has
  // claimed it; "provider_accepted" means the provider took the request.
  if (["processing", "provider_accepted", "delivered", "suppressed"].includes(job.state)) return job;

  // Enforce attempts independently of state (never retry exhausted jobs)
  if ((job.attempts || 0) >= MAX_ATTEMPTS) {
    return await sr.entities.DeliveryJob.update(job.id, {
      state: "failed",
      last_error: job.last_error || "Max attempts reached",
    });
  }

  // Check suppression before every send
  const sup = await checkSuppression(sr, job.workspace_id, normalizeEmail(job.recipient_email));
  if (sup.suppressed) {
    return await sr.entities.DeliveryJob.update(job.id, {
      state: "suppressed",
      last_error: `Recipient suppressed: ${sup.reason}`,
    });
  }

  // Resolve sender, resource version, resource, business profile
  const [senderRes, rvRes] = await Promise.all([
    job.sender_id ? sr.entities.SenderIdentity.filter({ id: job.sender_id }) : Promise.resolve([]),
    job.resource_version_id ? sr.entities.ResourceVersion.filter({ id: job.resource_version_id }) : Promise.resolve([]),
  ]);
  const sender = firstRecord(senderRes);
  const rv = firstRecord(rvRes);
  if (!sender) {
    return await sr.entities.DeliveryJob.update(job.id, {
      state: "failed",
      last_error: "No sender identity configured for this workspace",
    });
  }

  let resourceTitle = "your resource";
  let businessName = "";
  if (rv) {
    const resource = firstRecord(await sr.entities.Resource.filter({ id: rv.resource_id }));
    if (resource) resourceTitle = resource.title || resourceTitle;
  }
  const profile = firstRecord(await sr.entities.BusinessProfile.filter({ workspace_id: job.workspace_id }));
  if (profile) businessName = profile.business_name || "";

  const accessUrl = job.access_url || `${origin}/r/${job.id}`;
  const subject = `Your ${resourceTitle} from ${businessName || "FunnelRoo"}`;
  const html = brandedEmail({ resourceTitle, businessName, recipientName: job.recipient_name, accessUrl });

  // Atomically claim: set state to "processing" only if still pending/failed.
  // This prevents two concurrent processors from both sending — the first to
  // claim wins; the second's updateMany doesn't match (state is now "processing").
  const claim = await sr.entities.DeliveryJob.updateMany(
    { id: job.id, state: { $in: ["pending", "failed"] } },
    { $set: { state: "processing" }, $inc: { attempts: 1 } }
  );
  if (!claim.updated) {
    // Someone else claimed it, or it's no longer in a processable state
    return firstRecord(await sr.entities.DeliveryJob.filter({ id: job.id })) || job;
  }

  try {
    const result = await sr.integrations.Core.SendEmail({
      to: job.recipient_email,
      subject,
      body: html,
      from_name: sender.from_name || businessName || "FunnelRoo",
    });
    // Provider accepted the request. Provider acceptance != inbox delivery.
    const messageId = result?.messageId || result?.id || result?.message_id || "";
    return await sr.entities.DeliveryJob.update(job.id, {
      state: "provider_accepted",
      provider_message_id: String(messageId || ""),
      last_error: "",
    });
  } catch (e) {
    const msg = String(e?.message || e);
    // Distinguish suppression-class failures from other errors
    const suppressed = /suppress|unsubscribe|bounce|complaint|invalid|not.*verified|domain/i.test(msg);
    // Distinguish uncertain outcomes (network/timeout) from known failures
    const uncertain = /timeout|network|connection|econnreset|aborted|socket/i.test(msg);
    return await sr.entities.DeliveryJob.update(job.id, {
      state: suppressed ? "suppressed" : "failed",
      last_error: uncertain ? `[uncertain] ${msg}` : msg,
    });
  }
}

function normalizeEmail(e) {
  return String(e || "").trim().toLowerCase();
}