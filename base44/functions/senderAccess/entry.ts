import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import {
  requireMembership,
  firstRecord,
  asArray,
  ok,
  err,
  HttpError,
} from "../../shared/auth.ts";
import { processDeliveryJob, isExternalProviderConfigured } from "../../shared/delivery.ts";

// Workspace-authorized sender identity management + delivery processing.
//
// Provider state: the platform Core.SendEmail is the interim provider. It
// sends from the app's own platform address — NOT the customer's sender
// email. A test send to the owner confirms the platform can deliver, but
// does NOT verify the customer's domain/address. An external email provider
// (Resend, SendGrid, etc.) can be added when configured; until then
// isExternalProviderConfigured() is false and senders stay unverified.

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const sr = base44.asServiceRole;

    // ---- list ----
    if (action === "list") {
      await requireMembership(base44, body.workspace_id);
      const senders = asArray(
        await sr.entities.SenderIdentity.filter({ workspace_id: body.workspace_id }, { sort: "-created_date" })
      );
      return ok({ senders, external_provider_configured: isExternalProviderConfigured() });
    }

    // ---- create ----
    if (action === "create") {
      const { user } = await requireMembership(base44, body.workspace_id, ["owner", "admin"]);
      const email = String(body.email || "").trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(400, "A valid sender email is required");
      const sender = await sr.entities.SenderIdentity.create({
        workspace_id: body.workspace_id,
        email,
        from_name: String(body.from_name || "").trim(),
        reply_to: String(body.reply_to || "").trim(),
        provider: "platform_sendemail",
        verified: false,
        verification_method: "none",
        status: "unverified",
      });
      return ok({ sender });
    }

    // ---- update ----
    // If email, from_name, or reply_to changes, invalidate verification.
    if (action === "update") {
      const sender = firstRecord(await sr.entities.SenderIdentity.filter({ id: body.sender_id }));
      if (!sender) return err(404, "Sender not found");
      await requireMembership(base44, sender.workspace_id, ["owner", "admin"]);
      const update = {};
      let identityChanged = false;
      if (body.email !== undefined) {
        const newEmail = String(body.email).trim().toLowerCase();
        if (newEmail !== sender.email) { update.email = newEmail; identityChanged = true; }
      }
      if (body.from_name !== undefined) {
        const newName = String(body.from_name).trim();
        if (newName !== sender.from_name) { update.from_name = newName; identityChanged = true; }
      }
      if (body.reply_to !== undefined) {
        const newReply = String(body.reply_to).trim();
        if (newReply !== sender.reply_to) { update.reply_to = newReply; identityChanged = true; }
      }
      // Invalidate verification when the relevant identity changes
      if (identityChanged) {
        update.verified = false;
        update.verification_method = "none";
        update.status = "unverified";
      }
      const updated = await sr.entities.SenderIdentity.update(sender.id, update);
      return ok({ sender: updated });
    }

    // ---- delete ----
    if (action === "delete") {
      const sender = firstRecord(await sr.entities.SenderIdentity.filter({ id: body.sender_id }));
      if (!sender) return err(404, "Sender not found");
      await requireMembership(base44, sender.workspace_id, ["owner", "admin"]);
      await sr.entities.SenderIdentity.delete(sender.id);
      return ok({ deleted: true });
    }

    // ---- testSend: send a test email to the owner's own registered email ----
    // This confirms the platform can deliver to the owner's address. It does
    // NOT verify the sender's email/domain — the platform sends from its own
    // address, not the customer's. The sender stays unverified.
    if (action === "testSend") {
      const { user } = await requireMembership(base44, body.workspace_id, ["owner", "admin"]);
      const sender = firstRecord(await sr.entities.SenderIdentity.filter({ id: body.sender_id }));
      if (!sender) return err(404, "Sender not found");
      await requireMembership(base44, sender.workspace_id, ["owner", "admin"]);
      const profile = firstRecord(await sr.entities.BusinessProfile.filter({ workspace_id: body.workspace_id }));
      const businessName = profile?.business_name || "FunnelRoo";
      try {
        await sr.integrations.Core.SendEmail({
          to: user.email,
          subject: `Test send from ${businessName}`,
          body: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:24px;"><h2>Test send successful</h2><p>This confirms the FunnelRoo platform can send email on behalf of <strong>${escapeHtml(businessName)}</strong>.</p><p style="color:#64748b;font-size:13px;">From name: ${escapeHtml(sender.from_name || businessName)}<br/>Sender email on record: ${escapeHtml(sender.email)}<br/><br/>Note: emails are sent from FunnelRoo's platform address, not your custom domain. Your sender email is not used as the from address. Domain verification requires an external email provider.</p></body></html>`,
          from_name: sender.from_name || businessName,
        });
        // Do NOT mark as verified — test send confirms platform delivery, not domain verification
        const updated = await sr.entities.SenderIdentity.update(sender.id, {
          last_test_at: new Date().toISOString(),
          last_test_result: "ok — platform delivery confirmed (not domain-verified)",
        });
        return ok({ sender: updated });
      } catch (e) {
        const updated = await sr.entities.SenderIdentity.update(sender.id, {
          last_test_at: new Date().toISOString(),
          last_test_result: String(e?.message || e),
        });
        return ok({ sender: updated, error: updated.last_test_result });
      }
    }

    // ---- processPending: retry pending/failed jobs for this workspace ----
    // Never retries suppressed jobs (they are excluded from the filter).
    // Enforces MAX_ATTEMPTS independently of state.
    if (action === "processPending") {
      await requireMembership(base44, body.workspace_id, ["owner", "admin"]);
      const jobs = asArray(
        await sr.entities.DeliveryJob.filter(
          { workspace_id: body.workspace_id, state: { $in: ["pending", "failed"] } },
          { sort: "created_date", limit: 50 }
        )
      );
      const origin = (() => { try { return new URL(req.url).origin; } catch { return ""; } })();
      const results = [];
      for (const job of jobs) {
        if ((job.attempts || 0) >= 3) continue;
        const r = await processDeliveryJob(base44, job, origin);
        results.push({ id: job.id, state: r.state, error: r.last_error });
      }
      return ok({ processed: results });
    }

    return err(400, `Unknown action: ${action}`);
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}