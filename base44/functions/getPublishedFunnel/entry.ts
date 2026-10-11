import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { firstRecord, ok, err } from "../../shared/auth.ts";

// Public, anonymous read of a published funnel by its immutable public_id.
// Returns only approved published content — no drafts, contacts, or secrets.
// The public_id is a globally-unique immutable discriminator so two workspaces
// can never collide on the same public URL.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const publicId = String(body.public_id || "").trim();
    if (!publicId) return err(400, "Missing funnel identifier");

    const sr = base44.asServiceRole;
    const funnel = firstRecord(
      await sr.entities.Funnel.filter({ public_id: publicId, state: "published" })
    );
    if (!funnel) return err(404, "Funnel not found or not published");

    const version = firstRecord(
      await sr.entities.PublishedFunnelVersion.filter({
        id: funnel.active_version_id,
        active: true,
      })
    );
    if (!version) return err(404, "No active published version");

    const snapshot = version.snapshot || {};
    const blocks = snapshot.page_blocks || [];
    const formBlock = blocks.find((b) => b.type === "form");
    const formFields = formBlock?.props?.fields || [];
    const formVersion = JSON.stringify(formFields.map((f) => ({ n: f.name, l: f.label, t: f.type, r: !!f.required })));
    return ok({
      funnel: {
        name: funnel.name,
        type: funnel.type,
        slug: funnel.slug,
        public_id: funnel.public_id,
        goal: funnel.goal,
      },
      version: {
        version_number: version.version_number,
        published_at: version.published_at,
        snapshot,
        version_id: version.id,
      },
      form_version: formVersion,
      delivery_mode: snapshot.delivery_mode || "immediate_only",
      consent_text: snapshot.consent_text || "",
      resource: snapshot.resource_version_id
        ? { title: snapshot.resource_title || "", delivery_mode: snapshot.delivery_mode || "immediate_only" }
        : null,
    });
  } catch (e) {
    return err(500, e.message);
  }
}