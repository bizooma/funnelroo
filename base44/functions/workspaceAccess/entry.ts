import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import {
  requireUser,
  requireMembership,
  firstRecord,
  asArray,
  ok,
  err,
  HttpError,
} from "../../shared/auth.ts";

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const sr = base44.asServiceRole;

    // ---- listMine: workspaces the user belongs to ----
    if (action === "listMine") {
      const user = await requireUser(base44);
      const memberships = asArray(
        await sr.entities.Membership.filter({ user_id: user.id, status: "active" })
      );
      if (!memberships.length) return ok({ workspaces: [] });
      const ids = memberships.map((m) => m.workspace_id);
      const wsResult = await sr.entities.Workspace.filter({ id: { $in: ids } });
      const workspaces = asArray(wsResult);
      const byId = {};
      memberships.forEach((m) => (byId[m.workspace_id] = m.role));
      return ok({
        workspaces: workspaces.map((w) => ({ ...w, my_role: byId[w.id] })),
      });
    }

    // ---- create: new workspace + owner membership + empty profile ----
    if (action === "create") {
      const user = await requireUser(base44);
      const name = String(body.name || "").trim();
      if (!name) return err(400, "Workspace name is required");
      let slug = slugify(body.slug || name);
      const existing = asArray(await sr.entities.Workspace.filter({ slug }));
      if (existing.length) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
      const workspace = await sr.entities.Workspace.create({
        name,
        slug,
        owner_id: user.id,
        time_zone: body.time_zone || "America/Chicago",
        currency: body.currency || "USD",
        status: "active",
        plan: "trial",
        onboarding_complete: false,
      });
      await sr.entities.Membership.create({
        workspace_id: workspace.id,
        user_id: user.id,
        user_email: user.email,
        user_name: user.full_name,
        role: "owner",
        status: "active",
      });
      await sr.entities.BusinessProfile.create({
        workspace_id: workspace.id,
        business_name: name,
        time_zone: workspace.time_zone,
        currency: workspace.currency,
        onboarding_complete: false,
      });
      return ok({ workspace });
    }

    // ---- getContext: workspace + profile + my role + member count ----
    if (action === "getContext") {
      const { membership } = await requireMembership(base44, body.workspace_id);
      const workspace = firstRecord(
        await sr.entities.Workspace.filter({ id: body.workspace_id })
      );
      const profile = firstRecord(
        await sr.entities.BusinessProfile.filter({ workspace_id: body.workspace_id })
      );
      const memberCount = await sr.entities.Membership.count({
        workspace_id: body.workspace_id,
        status: "active",
      });
      return ok({ workspace, profile, my_role: membership.role, member_count: memberCount });
    }

    // ---- invite: owner/admin only ----
    if (action === "invite") {
      const { user, membership } = await requireMembership(base44, body.workspace_id, [
        "owner",
        "admin",
      ]);
      const email = String(body.email || "").trim().toLowerCase();
      if (!email) return err(400, "Email is required");
      const role = body.role === "admin" ? "admin" : "member";
      const token = crypto.randomUUID();
      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const invite = await sr.entities.Invite.create({
        workspace_id: body.workspace_id,
        email,
        role,
        token,
        status: "pending",
        expires_at: expires,
        invited_by: user.id,
      });
      return ok({ invite });
    }

    // ---- listInvites ----
    if (action === "listInvites") {
      await requireMembership(base44, body.workspace_id, ["owner", "admin"]);
      const invites = asArray(
        await sr.entities.Invite.filter({
          workspace_id: body.workspace_id,
          status: "pending",
        })
      );
      return ok({ invites });
    }

    // ---- listMembers ----
    if (action === "listMembers") {
      await requireMembership(base44, body.workspace_id);
      const members = asArray(
        await sr.entities.Membership.filter({
          workspace_id: body.workspace_id,
          status: "active",
        })
      );
      return ok({ members });
    }

    // ---- updateMemberRole: owner only, authorizes the TARGET record ----
    if (action === "updateMemberRole") {
      const { membership } = await requireMembership(base44, body.workspace_id, ["owner"]);
      // Load the target membership and authorize by its actual workspace
      const target = firstRecord(await sr.entities.Membership.filter({ id: body.member_id }));
      if (!target) return err(404, "Member not found");
      if (target.workspace_id !== body.workspace_id) {
        return err(403, "Member not in this workspace");
      }
      // Only admin/member are settable here; ownership changes go through transferOwnership
      const newRole = body.role;
      if (!["admin", "member"].includes(newRole)) {
        return err(400, "Invalid role. Use transfer ownership to change ownership.");
      }
      // Cannot change your own role here
      if (target.id === membership.id) {
        return err(400, "Use transfer ownership to change your own role");
      }
      // Cannot change an owner's role here
      if (target.role === "owner") {
        return err(400, "Use transfer ownership to change the owner");
      }
      await sr.entities.Membership.update(target.id, { role: newRole });
      return ok({ updated: true });
    }

    // ---- transferOwnership: owner only, promotes target and demotes self ----
    if (action === "transferOwnership") {
      const { membership } = await requireMembership(base44, body.workspace_id, ["owner"]);
      const target = firstRecord(await sr.entities.Membership.filter({ id: body.member_id }));
      if (!target) return err(404, "Member not found");
      if (target.workspace_id !== body.workspace_id) {
        return err(403, "Member not in this workspace");
      }
      if (target.id === membership.id) return err(400, "You are already the owner");
      if (target.status !== "active") return err(400, "Target member is not active");
      // Demote current owner to admin, promote target to owner
      await sr.entities.Membership.update(membership.id, { role: "admin" });
      await sr.entities.Membership.update(target.id, { role: "owner" });
      return ok({ transferred: true });
    }

    // ---- removeMember: owner or admin, authorizes the TARGET record ----
    if (action === "removeMember") {
      const { membership } = await requireMembership(base44, body.workspace_id, [
        "owner",
        "admin",
      ]);
      const target = firstRecord(
        await sr.entities.Membership.filter({ id: body.member_id })
      );
      if (!target || target.workspace_id !== body.workspace_id) {
        return err(404, "Member not found in this workspace");
      }
      if (target.role === "owner") return err(400, "Cannot remove the owner");
      if (target.id === membership.id) return err(400, "You cannot remove yourself");
      await sr.entities.Membership.update(body.member_id, {
        status: "revoked",
      });
      return ok({ removed: true });
    }

    // ---- acceptInvite: matches the intended recipient, preserves ownership ----
    if (action === "acceptInvite") {
      const user = await requireUser(base44);
      const invite = firstRecord(
        await sr.entities.Invite.filter({
          token: body.token,
          status: "pending",
        })
      );
      if (!invite) return err(404, "Invite not found or already used");
      if (new Date(invite.expires_at).getTime() < Date.now()) {
        await sr.entities.Invite.update(invite.id, { status: "expired" });
        return err(410, "This invite has expired");
      }
      // Match the authenticated user to the intended recipient email
      if (invite.email !== String(user.email || "").toLowerCase()) {
        return err(403, "This invite was sent to a different email address. Log in with the correct account.");
      }
      // Atomically claim the invite so concurrent acceptances don't double-process
      await sr.entities.Invite.updateMany(
        { id: invite.id, status: "pending" },
        { $set: { status: "accepted" } }
      );
      // Create or update membership, preserving ownership and never downgrading
      const existing = firstRecord(
        await sr.entities.Membership.filter({
          workspace_id: invite.workspace_id,
          user_id: user.id,
        })
      );
      let finalRole = invite.role;
      if (existing) {
        if (existing.role === "owner") {
          // Preserve ownership — never downgrade an owner
          finalRole = "owner";
          await sr.entities.Membership.update(existing.id, { status: "active" });
        } else {
          // Only upgrade (member → admin), never downgrade
          finalRole = (invite.role === "admin" && existing.role === "member") ? "admin" : existing.role;
          await sr.entities.Membership.update(existing.id, { status: "active", role: finalRole });
        }
      } else {
        await sr.entities.Membership.create({
          workspace_id: invite.workspace_id,
          user_id: user.id,
          user_email: user.email,
          user_name: user.full_name,
          role: invite.role,
          status: "active",
        });
        // Dedup in case of concurrent creates
        const dups = asArray(
          await sr.entities.Membership.filter({ workspace_id: invite.workspace_id, user_id: user.id })
        );
        if (dups.length > 1) {
          for (let i = 1; i < dups.length; i++) {
            try { await sr.entities.Membership.delete(dups[i].id); } catch {}
          }
        }
      }
      return ok({ workspace_id: invite.workspace_id, role: finalRole });
    }

    // ---- updateWorkspace (owner only) ----
    if (action === "updateWorkspace") {
      await requireMembership(base44, body.workspace_id, ["owner"]);
      const update = {};
      if (body.name) update.name = body.name;
      if (body.mascot_image_url !== undefined) update.mascot_image_url = body.mascot_image_url;
      if (body.plan) update.plan = body.plan;
      if (body.status) update.status = body.status;
      const workspace = await sr.entities.Workspace.update(
        body.workspace_id,
        update
      );
      return ok({ workspace });
    }

    return err(400, `Unknown action: ${action}`);
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}