import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { firstRecord, ok, err } from "../../shared/auth.ts";

// Public resource-access resolver. Validates an unguessable access token,
// resolves the exact resource version bound to the grant, and issues a
// fresh short-lived download URL server-side. Never exposes file_uri,
// private paths, or other workspaces' data.

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    if (!token) return err(400, "Missing access token");

    const sr = base44.asServiceRole;
    const grant = firstRecord(await sr.entities.ResourceGrant.filter({ access_token: token }));
    if (!grant) return err(404, "This link is not valid");
    if (grant.revoked) return err(410, "Access to this resource has been revoked");
    if (grant.expires_at && new Date(grant.expires_at).getTime() < Date.now()) {
      return err(410, "This link has expired");
    }

    const rv = firstRecord(await sr.entities.ResourceVersion.filter({ id: grant.resource_version_id }));
    if (!rv) return err(404, "The resource is no longer available");

    // mark accessed (does not prove a full download)
    await sr.entities.ResourceGrant.update(grant.id, { accessed_at: new Date().toISOString() });

    if (rv.delivery_type === "external") {
      return ok({
        delivery_type: "external",
        external_url: rv.external_url,
        filename: "",
        content_type: "",
        signed_url: "",
      });
    }

    // file: issue a fresh short-lived signed URL server-side
    const signed = await sr.integrations.Core.CreateFileSignedUrl({
      file_uri: rv.file_uri,
      expires_in: 300,
    });
    return ok({
      delivery_type: "file",
      signed_url: signed?.signed_url || "",
      filename: rv.filename || "resource",
      content_type: rv.content_type || "application/octet-stream",
      external_url: "",
    });
  } catch (e) {
    return err(500, e.message);
  }
}