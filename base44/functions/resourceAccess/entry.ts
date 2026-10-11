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
      // attach active version summary
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

    // ---- createVersion (file upload already done client-side -> file_uri) ----
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
        // file: client uploaded via UploadPrivateFile and passes file_uri + metadata
        if (!body.file_uri) return err(400, "file_uri is required for file resources");
        if (body.size_bytes && Number(body.size_bytes) > MAX_FILE_BYTES) {
          return err(400, `File exceeds the ${MAX_FILE_BYTES / 1024 / 1024}MB limit`);
        }
        if (body.content_type && !ALLOWED_FILE_TYPES.includes(body.content_type)) {
          return err(400, "This file type is not supported");
        }
        versionData.file_uri = String(body.file_uri);
        versionData.filename = String(body.filename || "resource");
        versionData.content_type = String(body.content_type || "application/octet-stream");
        versionData.size_bytes = Number(body.size_bytes || 0);
      }

      // count existing versions
      const versions = asArray(await sr.entities.ResourceVersion.filter({ resource_id: resource.id }));
      const versionNumber = versions.length + 1;
      versionData.version_number = versionNumber;

      // deactivate previous active version
      if (resource.active_version_id) {
        await sr.entities.ResourceVersion.update(resource.active_version_id, { active: false });
      }
      const version = await sr.entities.ResourceVersion.create(versionData);
      // promote new version as active on the resource
      await sr.entities.Resource.update(resource.id, { active_version_id: version.id, delivery_type });
      return ok({ resource: await sr.entities.Resource.update(resource.id, {}), version });
    }

    // ---- attachToFunnel: set the draft's resource_version_id ----
    if (action === "attachToFunnel") {
      const resource = firstRecord(await sr.entities.Resource.filter({ id: body.resource_id }));
      if (!resource) return err(404, "Resource not found");
      await requireMembership(base44, resource.workspace_id, ["owner", "admin", "member"]);
      // resolve funnel workspace
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