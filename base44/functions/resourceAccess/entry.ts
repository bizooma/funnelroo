import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import {
  requireMembership,
  firstRecord,
  asArray,
  ok,
  err,
  HttpError,
} from "../../shared/auth.ts";

// Workspace-authorized resource library: resources, versions, attach to funnel.
// File uploads are bound to workspace ownership via a server-authorized Upload
// record. The client uploads via UploadPrivateFile, then registers the file_uri
// with the server (which authorizes the workspace and creates an Upload record).
// createVersion resolves the file_uri from the Upload record — never from the
// client directly — and verifies the Upload's workspace matches the resource's.

const ALLOWED_FILE_TYPES = [
  "application/pdf", "application/zip",
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "text/plain", "text/csv", "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB platform upload limit

function normalizeUrl(u) {
  if (!u) return "";
  const s = String(u).trim();
  if (!/^https:\/\//i.test(s)) throw new HttpError(400, "External resource URL must start with https://");
  try { new URL(s); } catch { throw new HttpError(400, "Invalid external resource URL"); }
  return s;
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const sr = base44.asServiceRole;

    // ---- list ----
    if (action === "list") {
      await requireMembership(base44, body.workspace_id);
      const resources = asArray(
        await sr.entities.Resource.filter({ workspace_id: body.workspace_id, archived: { $ne: true } }, { sort: "-created_date" })
      );
      const versionIds = resources.map((r) => r.active_version_id).filter(Boolean);
      let versionsById = {};
      if (versionIds.length) {
        const versions = asArray(await sr.entities.ResourceVersion.filter({ id: { $in: versionIds } }));
        versions.forEach((v) => (versionsById[v.id] = v));
      }
      return ok({
        resources: resources.map((r) => ({
          ...r,
          active_version: r.active_version_id ? versionsById[r.active_version_id] : null,
        })),
      });
    }

    // ---- get (resource + versions) ----
    if (action === "get") {
      const resource = firstRecord(await sr.entities.Resource.filter({ id: body.resource_id }));
      if (!resource) return err(404, "Resource not found");
      await requireMembership(base44, resource.workspace_id);
      const versions = asArray(
        await sr.entities.ResourceVersion.filter({ resource_id: resource.id }, { sort: "-version_number" })
      );
      return ok({ resource, versions });
    }

    // ---- create ----
    if (action === "create") {
      await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const title = String(body.title || "").trim();
      if (!title) return err(400, "Title is required");
      const delivery_type = body.delivery_type === "external" ? "external" : "file";
      const resource = await sr.entities.Resource.create({
        workspace_id: body.workspace_id,
        title,
        description: String(body.description || "").trim(),
        delivery_type,
        archived: false,
      });
      return ok({ resource });
    }

    // ---- update ----
    if (action === "update") {
      const resource = firstRecord(await sr.entities.Resource.filter({ id: body.resource_id }));
      if (!resource) return err(404, "Resource not found");
      await requireMembership(base44, resource.workspace_id, ["owner", "admin", "member"]);
      const update = {};
      if (body.title !== undefined) update.title = String(body.title).trim();
      if (body.description !== undefined) update.description = String(body.description).trim();
      if (body.archived !== undefined) update.archived = !!body.archived;
      const updated = await sr.entities.Resource.update(resource.id, update);
      return ok({ resource: updated });
    }

    // ---- registerUpload: bind a client-uploaded file_uri to a workspace ----
    // The client uploads via UploadPrivateFile (client-side), then calls this
    // action. The server authorizes the workspace, validates the file metadata,
    // and creates an Upload record binding file_uri to the workspace. The
    // returned upload_id is then passed to createVersion.
    if (action === "registerUpload") {
      const { user } = await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const fileUri = String(body.file_uri || "").trim();
      if (!fileUri) return err(400, "file_uri is required");
      const filename = String(body.filename || "").trim();
      if (!filename) return err(400, "filename is required");
      const contentType = String(body.content_type || "application/octet-stream");
      if (!ALLOWED_FILE_TYPES.includes(contentType)) {
        return err(400, "This file type is not supported");
      }
      const sizeBytes = Number(body.size_bytes || 0);
      if (sizeBytes > MAX_FILE_BYTES) {
        return err(400, `File exceeds the ${MAX_FILE_BYTES / 1024 / 1024}MB limit`);
      }
      const upload = await sr.entities.Upload.create({
        workspace_id: body.workspace_id,
        file_uri: fileUri,
        filename,
        content_type: contentType,
        size_bytes: sizeBytes,
        created_by: user.id,
        consumed: false,
      });
      return ok({ upload_id: upload.id });
    }

    // ---- createVersion ----
    // For file resources, takes upload_id (NOT raw file_uri). Resolves the
    // Upload record, verifies its workspace matches the resource's workspace,
    // and uses the trusted file_uri + metadata from the Upload record.
    if (action === "createVersion") {
      const resource = firstRecord(await sr.entities.Resource.filter({ id: body.resource_id }));
      if (!resource) return err(404, "Resource not found");
      const { user } = await requireMembership(base44, resource.workspace_id, ["owner", "admin", "member"]);
      const delivery_type = body.delivery_type === "external" ? "external" : resource.delivery_type || "file";

      let versionData = {
        workspace_id: resource.workspace_id,
        resource_id: resource.id,
        delivery_type,
        created_by: user.id,
        active: true,
      };

      if (delivery_type === "external") {
        versionData.external_url = normalizeUrl(body.external_url);
        versionData.filename = "";
      } else {
        // File: resolve from the server-authorized Upload record
        const uploadId = String(body.upload_id || "").trim();
        if (!uploadId) return err(400, "upload_id is required for file resources");
        const upload = firstRecord(await sr.entities.Upload.filter({ id: uploadId }));
        if (!upload) return err(404, "Upload not found");
        if (upload.workspace_id !== resource.workspace_id) {
          return err(403, "Upload does not belong to this workspace");
        }
        // Use trusted metadata from the Upload record (not client-supplied)
        versionData.file_uri = upload.file_uri;
        versionData.filename = upload.filename;
        versionData.content_type = upload.content_type;
        versionData.size_bytes = upload.size_bytes;
        // Mark the upload as consumed
        await sr.entities.Upload.update(upload.id, { consumed: true });
      }

      const versions = asArray(await sr.entities.ResourceVersion.filter({ resource_id: resource.id }));
      const versionNumber = versions.length + 1;
      versionData.version_number = versionNumber;

      if (resource.active_version_id) {
        await sr.entities.ResourceVersion.update(resource.active_version_id, { active: false });
      }
      const version = await sr.entities.ResourceVersion.create(versionData);
      await sr.entities.Resource.update(resource.id, { active_version_id: version.id, delivery_type });
      return ok({ resource: await sr.entities.Resource.update(resource.id, {}), version });
    }

    // ---- attachToFunnel: set the draft's resource_version_id ----
    if (action === "attachToFunnel") {
      const resource = firstRecord(await sr.entities.Resource.filter({ id: body.resource_id }));
      if (!resource) return err(404, "Resource not found");
      await requireMembership(base44, resource.workspace_id, ["owner", "admin", "member"]);
      const funnel = firstRecord(await sr.entities.Funnel.filter({ id: body.funnel_id }));
      if (!funnel) return err(404, "Funnel not found");
      if (funnel.workspace_id !== resource.workspace_id) {
        return err(403, "Resource and funnel belong to different workspaces");
      }
      const draft = firstRecord(await sr.entities.FunnelDraft.filter({ funnel_id: funnel.id }));
      if (!draft) return err(400, "Save the funnel draft first");
      const versionId = body.resource_version_id || resource.active_version_id;
      if (!versionId) return err(400, "This resource has no version yet");
      const version = firstRecord(await sr.entities.ResourceVersion.filter({ id: versionId, resource_id: resource.id }));
      if (!version) return err(404, "Resource version not found");
      const updated = await sr.entities.FunnelDraft.update(draft.id, {
        resource_id: resource.id,
        resource_version_id: version.id,
      });
      return ok({ draft: updated });
    }

    return err(400, `Unknown action: ${action}`);
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}