// Shared authorization helper for FunnelRoo multi-tenant access.
// All tenant data access goes through backend functions that use the service
// role and perform explicit membership + role + workspace checks. RLS on each
// entity is defense-in-depth (platform-operator only) and is not the boundary.

import type {
  Page,
  Row,
  ServiceRoleClient,
  UsageOperationRecord,
} from "./models.ts";

export interface AuthUser {
  id: string;
  email?: string;
  full_name?: string;
  role?: string;
}

export interface MembershipRecord extends Row {
  id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  status: string;
  user_email?: string;
  user_name?: string;
}

export interface FunnelRecord extends Row {
  id: string;
  workspace_id: string;
  public_id?: string | null;
}

/** Minimal caller surface used by shared authorization. */
export interface RequestClient {
  auth: { me(): Promise<AuthUser | null> };
  asServiceRole: ServiceRoleClient;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

export function firstRecord<T extends Row>(result: T[] | Page<T> | T | null | undefined): T | undefined {
  if (Array.isArray(result)) return result[0];
  if (result && Array.isArray((result as Page<T>).items)) return (result as Page<T>).items[0];
  return (result as T) ?? undefined;
}

export function asArray<T extends Row>(result: T[] | Page<T> | T | null | undefined): T[] {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray((result as Page<T>).items)) return (result as Page<T>).items;
  return [];
}

export async function requireUser(base44: RequestClient): Promise<AuthUser> {
  const user = await base44.auth.me();
  if (!user) throw new HttpError(401, "Unauthorized");
  return user;
}

// Verify the authenticated user is an active member of the workspace with one
// of the allowed roles. Returns { user, membership }.
export async function requireMembership(
  base44: RequestClient,
  workspaceId: string,
  roles?: string[]
): Promise<{ user: AuthUser; membership: MembershipRecord }> {
  const allowed = roles || ["owner", "admin", "member"];
  const user = await requireUser(base44);
  if (!workspaceId) throw new HttpError(400, "Missing workspace");
  const result = await base44.asServiceRole.entities.Membership.filter({
    workspace_id: workspaceId,
    user_id: user.id,
    status: "active",
  });
  const membership = firstRecord<MembershipRecord>(result as MembershipRecord[]);
  if (!membership) throw new HttpError(403, "No access to this workspace");
  if (!allowed.includes(membership.role)) {
    throw new HttpError(403, "Your role does not permit this action");
  }
  return { user, membership };
}

// Resolve the workspace id from a funnel id, so callers can authorize by the
// record's actual tenant rather than a client-supplied workspace id.
export async function resolveFunnelWorkspace(
  base44: RequestClient,
  funnelId: string
): Promise<{ funnel: FunnelRecord; workspaceId: string }> {
  const result = await base44.asServiceRole.entities.Funnel.filter({ id: funnelId });
  const funnel = firstRecord<FunnelRecord>(result as FunnelRecord[]);
  if (!funnel) throw new HttpError(404, "Funnel not found");
  return { funnel, workspaceId: funnel.workspace_id };
}

// The trusted platform operator is the app-level administrator. This is
// deliberately NOT the workspace role: a workspace owner, admin or member is a
// customer and is never a platform operator.
export function isPlatformOperator(user: AuthUser | null | undefined): boolean {
  return !!user && user.role === "admin";
}

export function ok(data: unknown, status?: number): Response {
  return Response.json(data, { status: status || 200 });
}

export function err(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

// Generate a short, URL-safe, globally-unique public id for funnels.
// Not a hard uniqueness guarantee (Base44 has no unique constraints); callers
// should check for collisions at creation time.
export function generatePublicId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

// Deterministic JSON serialization for payload fingerprinting.
// Sorts object keys at every depth so the same logical payload always
// produces the same string regardless of key insertion order.
export function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj) ?? "null";
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(record[k])).join(",") + "}";
}

export interface AudienceCoreFacts extends Row {
  name?: string;
  roles_industries?: string;
  problems?: string[];
  desired_outcomes?: string[];
  objections?: string[];
  alternatives?: string[];
  description?: string;
}

// Deterministic hash of the core audience facts a persona card reflects.
// When these change, previously generated persona guidance is flagged stale.
// Uses the full stable serialization so ANY core-field change is detected
// (a truncated hash would miss fields beyond the truncation point).
export function audienceContentHash(a: AudienceCoreFacts): string {
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
export function computeFingerprint(payload: unknown): string {
  return stableStringify(payload);
}

// Deduplicate records by a query, keeping the oldest (by created_date, then id).
// Calls reassign(duplicateId, survivorId) for each duplicate before deletion
// so related records can be repointed. Returns the survivor.
export async function dedupKeepOldest<T extends Row>(
  sr: ServiceRoleClient,
  entityName: string,
  query: Row,
  reassign?: (duplicateId: string, survivorId: string) => Promise<void>
): Promise<T | undefined> {
  const repo = sr.entities[entityName];
  const records = asArray<T>(
    (await repo.filter(query, { sort: "created_date" })) as T[] | Page<T>
  );
  if (records.length <= 1) return records[0];
  const survivor = records[0];
  for (let i = 1; i < records.length; i++) {
    const dup = records[i];
    if (reassign) {
      try {
        await reassign(dup.id, survivor.id);
      } catch {
        // Recovery of related records is best-effort; the duplicate is still removed.
      }
    }
    try {
      await repo.delete(dup.id);
    } catch {
      // Already gone.
    }
  }
  return survivor;
}

export type { UsageOperationRecord };