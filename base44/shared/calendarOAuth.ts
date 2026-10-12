import { firstRecord, requireMembership, requireUser, HttpError } from "./auth.ts";

export async function consumeCalendlyState(base44, state) {
  if (!/^[a-f0-9]{64}$/.test(state)) throw new HttpError(400, "Invalid authorization state. Click Connect Calendly again.");
  const user = await requireUser(base44);
  const sr = base44.asServiceRole;
  const stored = firstRecord(await sr.entities.CalendlyOAuthState.filter({ state, user_id: user.id }, { limit: 1 }));
  if (!stored || stored.consumed || new Date(stored.expires_at).getTime() <= Date.now()) {
    throw new HttpError(400, "Authorization expired or already used. Click Connect Calendly again.");
  }
  await requireMembership(base44, stored.workspace_id, ["owner", "admin"]);
  const claimId = crypto.randomUUID();
  await sr.entities.CalendlyOAuthState.updateMany(
    { id: stored.id, consumed: false },
    { $set: { consumed: true, claim_id: claimId, code_verifier: "" } }
  );
  const claimed = await sr.entities.CalendlyOAuthState.get(stored.id);
  if (claimed.claim_id !== claimId) throw new HttpError(409, "Authorization already in progress. Click Connect Calendly again.");
  return { ...stored, return_path: "/settings?tab=integrations" };
}

// Browser redirects do not carry the app's SDK bearer token. Forward the
// provider result to Settings, where the signed-in SDK completes the exchange.
export function forwardCalendlyCallback(req) {
  const reqUrl = new URL(req.url);
  const params = reqUrl.searchParams;
  const target = new URL("/settings?tab=integrations", reqUrl.origin);
  for (const key of ["code", "state", "error"]) {
    const value = params.get(key);
    if (value && value.length <= 4096) target.searchParams.set(`calendly_${key}`, value);
  }
  if (!params.has("code") && !params.has("error")) target.searchParams.set("calendly_error", "missing_callback");
  return new Response(null, { status: 303, headers: {
    Location: target.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer"
  } });
}