// Shared delivery logic for requested-resource emails.
// Used by captureSubmission (immediate send after acceptance) and
// senderAccess (manual retry / reconciliation). Keeps a single source of
// truth for the branded email body and provider call.

import { firstRecord, asArray } from "./auth.ts";

const MAX_ATTEMPTS = 3;

function brandedEmail({ resourceTitle, businessName, recipientName, accessUrl }) {
  const greeting = recipientName ? `Hi ${recipientName},` : `Hi,`;
  const safeBusiness = businessName || "the team";
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr><td style="padding:18px 28px;">
      <span style="color:#ffffff;font-size:16px;font-weight:bold;letter-spacing:.2px;">FunnelRoo</span>
      <span style="color:#9ca3af;font-size:12px;margin-left:8px;">via ${escapeHtml(safeBusiness)}</span>
    </td></tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:32px 28px;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
        <tr><td>
          <h1 style="color:#0a0a0a;font-size:22px;margin:0 0 12px;font-family:Arial,Arial,sans-serif;">Your ${escapeHtml(resourceTitle)} is ready</h1>
          <p style="color:#0a0a0a;font-size:15px;line-height:1.6;margin:0 0 16px;">${greeting}</p>
          <p style="color:#0a0a0a;font-size:15px;line-height:1.6;margin:0 0 24px;">Thanks for requesting <strong>${escapeHtml(resourceTitle)}</strong>. You can access it any time using the button below.</p>
          <table cellpadding="0" cellspacing="0"><tr><td style="background:#0a0a0a;border-radius:6px;">
            <a href="${escapeHtml(accessUrl)}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;font-family:Arial,Arial,sans-serif;">Access your resource</a>
          </td></tr></table>
          <p style="color:#64748b;font-size:13px;line-height:1.5;margin:24px 0 0;">If the button doesn't work, copy this link into your browser:<br/><span style="word-break:break-all;">${escapeHtml(accessUrl)}</span></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:18px 28px;">
    <tr><td align="center">
      <p style="color:#64748b;font-size:12px;margin:0;font-family:Arial,Arial,sans-serif;">Sent by ${escapeHtml(safeBusiness)} via FunnelRoo. This link grants access to the resource you requested.</p>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Process a single DeliveryJob: resolve context, send, update state.
// Returns the updated job. Does not throw on provider failure — records last_error.
export async function processDeliveryJob(base44, job, origin) {
  const sr = base44.asServiceRole;

  // Already terminal — skip
  if (["delivered", "suppressed"].includes(job.state)) return job;
  if (job.attempts >= MAX_ATTEMPTS && job.state === "failed") return job;

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
      attempts: (job.attempts || 0) + 1,
    });
  }
  if (!sender.verified) {
    return await sr.entities.DeliveryJob.update(job.id, {
      state: "failed",
      last_error: "Sender identity is not verified. Verify it in Settings before sending.",
      attempts: (job.attempts || 0) + 1,
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

  try {
    const result = await sr.integrations.Core.SendEmail({
      to: job.recipient_email,
      subject,
      html,
      from_name: sender.from_name || businessName || "FunnelRoo",
    });
    // Provider accepted the request. Provider acceptance != inbox delivery.
    const messageId = result?.messageId || result?.id || result?.message_id || "";
    return await sr.entities.DeliveryJob.update(job.id, {
      state: "provider_accepted",
      provider_message_id: String(messageId || ""),
      attempts: (job.attempts || 0) + 1,
      last_error: "",
    });
  } catch (e) {
    const msg = String(e?.message || e);
    // Distinguish suppression-class failures when possible
    const suppressed = /suppress|unsubscribe|bounce|complaint|invalid|not.*verified|domain/i.test(msg);
    return await sr.entities.DeliveryJob.update(job.id, {
      state: suppressed ? "suppressed" : "failed",
      last_error: msg,
      attempts: (job.attempts || 0) + 1,
    });
  }
}