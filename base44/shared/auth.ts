// Shared authorization helper for FunnelRoo multi-tenant access.
// All tenant data access goes through backend functions that use the service
// role and perform explicit membership + role + workspace checks. RLS on each
// entity is defense-in-depth (platform-operator only) and is not the boundary.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

function firstRecord(result) {
  if (Array.isArray(result)) return result[0];
  if (result && Array.isArray(result.items)) return result.items[0];
  return result;
}

function asArray(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.items)) return result.items;
  return [];
}

export async function requireUser(base44) {
  const user = await base44.auth.me();
  if (!user) throw new HttpError(401, "Unauthorized");
  return user;
}

// Verify the authenticated user is an active member of the workspace with one
// of the allowed roles. Returns { user, membership }.
export async function requireMembership(base44, workspaceId, roles) {
  const allowed = roles || ["owner", "admin", "member"];
  const user = await requireUser(base44);
  if (!workspaceId) throw new HttpError(400, "Missing workspace");
  const result = await base44.asServiceRole.entities.Membership.filter({
    workspace_id: workspaceId,
    user_id: user.id,
    status: "active",
  });
  const membership = firstRecord(result);
  if (!membership) throw new HttpError(403, "No access to this workspace");
  if (!allowed.includes(membership.role)) {
    throw new HttpError(403, "Your role does not permit this action");
  }
  return { user, membership };
}

// Resolve the workspace id from a funnel id, so callers can authorize by the
// record's actual tenant rather than a client-supplied workspace id.
export async function resolveFunnelWorkspace(base44, funnelId) {
  const result = await base44.asServiceRole.entities.Funnel.filter({ id: funnelId });
  const funnel = firstRecord(result);
  if (!funnel) throw new HttpError(404, "Funnel not found");
  return { funnel, workspaceId: funnel.workspace_id };
}

export function isPlatformOperator(user) {
  return user && user.role === "admin";
}

export function ok(data, status) {
  return Response.json(data, { status: status || 200 });
}

export function err(status, message) {
  return Response.json({ error: message }, { status });
}

export { firstRecord, asArray };