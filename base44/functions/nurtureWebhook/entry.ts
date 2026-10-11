import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { ok, err } from "../../shared/auth.ts";
import { verifyWebhookSignature, processProviderEvent } from "../../shared/nurture.ts";
import { secrets } from "base44:runtime";

// Resend webhook handler. Public endpoint — no user auth. Verifies the
// Svix/Resend signature against the raw request body, deduplicates events
// by provider event ID, maps to nurture messages, and updates outcomes.
//
// Hard bounces and complaints create suppression + stop enrollments.
// Delivery events do not reverse suppression or terminal outcomes.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;
    const secret = secrets.get("RESEND_WEBHOOK_SECRET");
    if (!secret) return err(503, "Webhook secret not configured");

    // Get raw body for signature verification
    const rawBody = await req.text();
    const sigHeader = req.headers.get("svix-signature") || "";
    const timestamp = req.headers.get("svix-timestamp") || "";
    const msgId = req.headers.get("svix-id") || "";

    const valid = await verifyWebhookSignature(rawBody, sigHeader, timestamp, msgId, secret);
    if (!valid) return err(401, "Invalid signature");

    const event = JSON.parse(rawBody);
    // Resend event shape: { type, data: { email_id, ... }, ... }
    // Map to our internal format
    const mapped = {
      event_id: event.uid || event.id || crypto.randomUUID(),
      message_id: event.data?.email_id || event.data?.message_id || "",
      event_type: String(event.type || "").replace(/^email\./, "").replace(/\./g, "_"),
      result: JSON.stringify(event.data || {}).slice(0, 500),
      workspace_id: "", // resolved from the message in processProviderEvent
    };

    const result = await processProviderEvent(sr, mapped);
    return ok(result);
  } catch (e) {
    return err(500, e.message);
  }
}