import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { firstRecord, ok, err } from "../../shared/auth.ts";
import { stopAllEnrollments } from "../../shared/nurture.ts";

// Public unsubscribe endpoint. No auth required — uses an opaque token
// scoped to workspace + contact. Supports:
// - GET-like "getInfo": returns contact first name for the confirmation page
//   (no state change — link previews must not cause unsubscribes)
// - POST "unsubscribe": idempotent suppression + cancel enrollments
// - POST "oneClick": RFC 8058 one-click unsubscribe (no confirmation needed)

function normalizeEmail(e) {
  return String(e || "").trim().toLowerCase();
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;
    // Support both JSON body (from frontend) and query params + raw POST
    // (from RFC 8058 one-click unsubscribe by email clients).
    const url = new URL(req.url);
    const rawBody = await req.text().catch(() => "");
    let body = {};
    if (rawBody && rawBody.trim().startsWith("{")) {
      try { body = JSON.parse(rawBody); } catch {}
    }
    // Query params override / supplement body (for one-click POST)
    const token = body.token || url.searchParams.get("token") || "";
    const action = body.action || url.searchParams.get("action") || "";
    // RFC 8058: the POST body is "List-Unsubscribe=One-Click"
    const isOneClickPost = rawBody.includes("List-Unsubscribe=One-Click");
    body.token = token;
    body.action = isOneClickPost ? "oneClick" : action;

    // ---- getInfo: return contact info for confirmation page (no state change) ----
    if (action === "getInfo") {
      const token = String(body.token || "").trim();
      if (!token) return err(400, "Missing token");
      const contact = firstRecord(
        await sr.entities.Contact.filter({ unsubscribe_token: token })
      );
      if (!contact) return err(404, "Invalid or expired link");
      // Return only the minimum needed for the confirmation page
      return ok({
        first_name: contact.first_name || "",
        email: contact.email || "",
        workspace_id: contact.workspace_id,
      });
    }

    // ---- unsubscribe: idempotent suppression + cancel enrollments ----
    if (action === "unsubscribe") {
      const token = String(body.token || "").trim();
      if (!token) return err(400, "Missing token");
      const contact = firstRecord(
        await sr.entities.Contact.filter({ unsubscribe_token: token })
      );
      if (!contact) return err(404, "Invalid or expired link");

      // Idempotent: check if already suppressed for unsubscribe
      const existing = firstRecord(
        await sr.entities.Suppression.filter({
          workspace_id: contact.workspace_id,
          email_normalized: contact.email_normalized,
          reason: "unsubscribe",
        })
      );
      if (!existing) {
        await sr.entities.Suppression.create({
          workspace_id: contact.workspace_id,
          contact_id: contact.id,
          email_normalized: contact.email_normalized,
          reason: "unsubscribe",
          source: "unsubscribe_link",
        });
      }
      // Cancel all active nurture enrollments across this workspace
      const stopped = await stopAllEnrollments(sr, contact.workspace_id, contact.id, "unsubscribe", "contact");
      return ok({ unsubscribed: true, stopped_enrollments: stopped });
    }

    // ---- oneClick: RFC 8058 one-click unsubscribe (no confirmation) ----
    if (action === "oneClick") {
      const token = String(body.token || "").trim();
      if (!token) return err(400, "Missing token");
      const contact = firstRecord(
        await sr.entities.Contact.filter({ unsubscribe_token: token })
      );
      if (!contact) return err(404, "Invalid token");

      // Same as unsubscribe — idempotent suppression + cancel
      const existing = firstRecord(
        await sr.entities.Suppression.filter({
          workspace_id: contact.workspace_id,
          email_normalized: contact.email_normalized,
          reason: "unsubscribe",
        })
      );
      if (!existing) {
        await sr.entities.Suppression.create({
          workspace_id: contact.workspace_id,
          contact_id: contact.id,
          email_normalized: contact.email_normalized,
          reason: "unsubscribe",
          source: "one_click_unsubscribe",
        });
      }
      await stopAllEnrollments(sr, contact.workspace_id, contact.id, "unsubscribe", "contact");
      return ok({ unsubscribed: true });
    }

    return err(400, `Unknown action: ${action}`);
  } catch (e) {
    return err(500, e.message);
  }
}