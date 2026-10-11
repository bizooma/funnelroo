import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { firstRecord, ok, err } from "../../shared/auth.ts";

// Public, anonymous read of a published funnel by slug.
// Returns only approved published content — no drafts, contacts, or secrets.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const url = new URL(req.url);
    const slug = url.searchParams.get("slug");
    if (!slug) return err(400, "Missing slug");

    const sr = base44.asServiceRole;
    const funnel = firstRecord(
      await sr.entities.Funnel.filter({ slug, state: { $in: ["published"] } })
    );
    if (!funnel) return err(404, "Funnel not found or not published");

    const version = firstRecord(
      await sr.entities.PublishedFunnelVersion.filter({
        id: funnel.active_version_id,
        active: true,
      })
    );
    if (!version) return err(404, "No active published version");

    // Return only the public snapshot + minimal funnel metadata
    return ok({
      funnel: {
        name: funnel.name,
        type: funnel.type,
        slug: funnel.slug,
        goal: funnel.goal,
      },
      version: {
        version_number: version.version_number,
        published_at: version.published_at,
        snapshot: version.snapshot,
      },
    });
  } catch (e) {
    return err(500, e.message);
  }
}