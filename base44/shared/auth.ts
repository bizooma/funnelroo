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

// Generate a short, URL-safe, globally-unique public id for funnels.
// Not a hard uniqueness guarantee (Base44 has no unique constraints); callers
// should check for collisions at creation time.
export function generatePublicId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

// Deterministic JSON serialization for payload fingerprinting.
// Sorts object keys at every depth so the same logical payload always
// produces the same string regardless of key insertion order.
export function stableStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

// Deterministic hash of the core audience facts a persona card reflects.
// When these change, previously generated persona guidance is flagged stale.
// Uses the full stable serialization so ANY core-field change is detected
// (a truncated hash would miss fields beyond the truncation point).
export function audienceContentHash(a) {
  const core = {
    name: a.name || "",
    roles_industries: a.roles_industries || "",
    problems: a.problems || [],
    desired_outcomes: a.desired_outcomes || [],
    objections: a.objections || [],
    alternatives: a.alternatives || [],
    description: a.description || "",
  };
  return stableStringify(core);
}

// Compute a payload fingerprint for submission idempotency.
// Same request_id + same fingerprint = retry → return same result.
// Same request_id + different fingerprint = conflict.
export function computeFingerprint(payload) {
  return stableStringify(payload);
}

// Deduplicate records by a query, keeping the oldest (by created_date, then id).
// Calls reassign(duplicateId, survivorId) for each duplicate before deletion
// so related records can be repointed. Returns the survivor.
export async function dedupKeepOldest(sr, entityName, query, reassign) {
  const records = asArray(await sr.entities[entityName].filter(query, { sort: "created_date" }));
  if (records.length <= 1) return records[0] || null;
  const survivor = records[0];
  for (let i = 1; i < records.length; i++) {
    const dup = records[i];
    if (reassign) {
      try { await reassign(dup.id, survivor.id); } catch {}
    }
    try { await sr.entities[entityName].delete(dup.id); } catch {}
  }
  return survivor;
}

export { firstRecord, asArray };