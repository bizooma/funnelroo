import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { ok, err, isPlatformOperator } from "../../shared/auth.ts";
import { dispatchDueMessages, isProviderConfigured } from "../../shared/nurture.ts";

// Scheduled dispatch entry point. Called by the NurtureDispatch workflow
// every 5 minutes. No user auth — this is a platform-scheduled maintenance
// task that processes due nurture messages across all workspaces.
//
// Safety: the function only sends due queued messages that pass all
// eligibility rechecks. It does not expose sensitive data, enroll contacts,
// or modify consent. Calling it externally only processes the queue (same
// as the scheduler would).
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const origin = (() => {
      try { return new URL(req.url).origin; } catch { return ""; }
    })();
    // mock=true forces the mock provider (for tests). The explicit mock is a test
    // affordance: only the platform operator may force it. Everyone else gets the
    // real provider when it is configured (and the mock only as the fallback when
    // no provider exists at all).
    let operatorForcedMock = false;
    if (body.mock === true) {
      try {
        const user = await base44.auth.me();
        operatorForcedMock = isPlatformOperator(user);
      } catch {
        operatorForcedMock = false;
      }
    }
    const mock = operatorForcedMock || !isProviderConfigured();
    const result = await dispatchDueMessages(sr, origin, { mock, batch: body.batch });
    return ok(result);
  } catch (e) {
    return err(500, e.message);
  }
}