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
  // The runtime request origin can be an internal dispatcher, not the
  // browser's public origin. Always return to the live site's auth session.
  const target = new URL("https://funnelroo.com/settings?tab=integrations");
  for (const key of ["code", "state", "error"]) {
    const value = params.get(key);
    if (value && value.length <= 4096) target.searchParams.set(`calendly_${key}`, value);
  }
  if (!params.has("code") && !params.has("error")) target.searchParams.set("calendly_error", "missing_callback");
  // Return an HTML page with a client-side redirect. The platform rewrites
  // HTTP 3xx Location headers to the internal dispatcher origin, which breaks
  // the auth session. A JS/meta redirect runs in the browser and lands on
  // the public site where the user's session cookie is valid.
  const safe = target.toString().replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connecting to FunnelRoo…</title>
<meta http-equiv="refresh" content="0;url=${safe}">
<script>window.location.replace(${JSON.stringify(target.toString())});</script>
</head><body style="font-family:system-ui,sans-serif;padding:2rem;color:#475569">Redirecting you back to FunnelRoo…</body></html>`;
  return new Response(html, { status: 200, headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer"
  } });
}