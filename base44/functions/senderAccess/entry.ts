import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import {
  requireMembership,
  firstRecord,
  asArray,
  ok,
  err,
  HttpError,
} from "../../shared/auth.ts";
import { processDeliveryJob } from "../../shared/delivery.ts";

// Workspace-authorized sender identity management + delivery processing.
// Uses the platform SendEmail integration as the provider. A sender is
// "verified" after a successful test send to the owner's own address.

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
      return ok({ senders });
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
        status: "unverified",
      });
      return ok({ sender });
    }

    // ---- update ----
    if (action === "update") {
      const sender = firstRecord(await sr.entities.SenderIdentity.filter({ id: body.sender_id }));
      if (!sender) return err(404, "Sender not found");
      await requireMembership(base44, sender.workspace_id, ["owner", "admin"]);
      const update = {};
      if (body.email !== undefined) update.email = String(body.email).trim().toLowerCase();
      if (body.from_name !== undefined) update.from_name = String(body.from_name).trim();
      if (body.reply_to !== undefined) update.reply_to = String(body.reply_to).trim();
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

    // ---- testSend: send to the owner's own registered email ----
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
          subject: `Test sender verification from ${businessName}`,
          html: `<div style="font-family:Arial,sans-serif;"><h2>Sender verified</h2><p>This confirms your FunnelRoo sender identity can send email.</p><p>From name: ${sender.from_name || businessName}</p></div>`,
          from_name: sender.from_name || businessName,
        });
        const updated = await sr.entities.SenderIdentity.update(sender.id, {
          verified: true,
          status: "verified",
          last_test_at: new Date().toISOString(),
          last_test_result: "ok",
        });
        return ok({ sender: updated });
      } catch (e) {
        const updated = await sr.entities.SenderIdentity.update(sender.id, {
          verified: false,
          status: "failed",
          last_test_at: new Date().toISOString(),
          last_test_result: String(e?.message || e),
        });
        return ok({ sender: updated, error: updated.last_test_result });
      }
    }

    // ---- processPending: retry pending/failed jobs for this workspace ----
    if (action === "processPending") {
      await requireMembership(base44, body.workspace_id, ["owner", "admin"]);
      const jobs = asArray(
        await sr.entities.DeliveryJob.filter({ workspace_id: body.workspace_id, state: { $in: ["pending", "failed"] } }, { sort: "created_date", limit: 50 })
      );
      const origin = (() => { try { return new URL(req.url).origin; } catch { return ""; } })();
      const results = [];
      for (const job of jobs) {
        if (job.attempts >= 3) continue;
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