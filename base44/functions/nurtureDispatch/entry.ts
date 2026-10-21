import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { ok, err, isPlatformOperator } from "../../shared/auth.ts";
import { dispatchDueMessages, isProviderConfigured } from "../../shared/nurture.ts";

// Scheduled dispatch entry point. Called by the NurtureDispatch workflow every
// 5 minutes to process due nurture messages across all workspaces.
//
// Authorization: the platform invokes this step AS the workflow's creator, an app
// admin. The URL is public, so this gate is what prevents an anonymous visitor
// from triggering a cross-workspace send. A rejected call never reaches the
// provider.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const origin = (() => {
      try { return new URL(req.url).origin; } catch { return ""; }
    })();
    // Trusted scheduler identity — see the note above. Reject anonymous and
    // customer-session callers before any queue work happens.
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      user = null;
    }
    if (!user) return err(401, "Authentication required.");
    if (!isPlatformOperator(user)) {
      return err(403, "Nurture dispatch is restricted to the platform operator.");
    }

    // The caller is now a verified operator, so an explicit mock request is
    // honoured; otherwise the real provider is used whenever it is configured.
    const mock = body.mock === true || !isProviderConfigured();
    const result = await dispatchDueMessages(sr, origin, { mock, batch: body.batch });
    return ok(result);
  } catch (e) {
    return err(500, e.message);
  }
}