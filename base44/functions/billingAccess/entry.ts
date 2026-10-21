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
import {
  publicCatalog,
  getPlan,
  TRIAL,
  CATALOG_VERSION,
} from "../../shared/plans.ts";
import {
  computeAccessState,
  trialEndDate,
  daysRemaining,
  usageWindowFor,
  ACCESS_STATES,
} from "../../shared/billing.ts";

// billingAccess: catalog, billing summary, trial start, and usage meters.
// No Stripe API calls in this phase — checkout/webhook/portal/reconcile live
// in a separate stripe adapter function that requires Stripe secrets.
// All entity access uses the service role; membership/ownership is enforced
// here, not by RLS (RLS is platform-operator-only defense-in-depth).

const ENV = "test";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const sr = base44.asServiceRole;

    // ---- getCatalog: public, no auth ----
    if (action === "getCatalog") {
      return ok({ catalog: publicCatalog() });
    }

    // ---- getBillingSummary ----
    if (action === "getBillingSummary") {
      const { membership } = await requireMembership(base44, body.workspace_id);
      const isOwner = membership.role === "owner";
      const billing = firstRecord(
        await sr.entities.WorkspaceBilling.filter({
          workspace_id: body.workspace_id,
          environment: ENV,
        })
      );
      const access = computeAccessState(billing);
      const usage = await computeUsage(sr, body.workspace_id, billing);
      const summary = {
        workspace_id: body.workspace_id,
        access_state: access,
        is_owner: isOwner,
        role: membership.role,
        plan: billing?.plan || null,
        plan_name: billing?.plan ? getPlan(billing.plan)?.name : null,
        interval: billing?.interval || null,
        status: billing?.status || null,
        catalog_version: billing?.catalog_version || null,
        trial:
          billing && billing.trial_started_at
            ? {
                started_at: billing.trial_started_at,
                ends_at: billing.trial_ends_at,
                days_remaining: daysRemaining(billing.trial_ends_at),
              }
            : null,
        usage,
      };
      // Financial details are owner-only. Admins/members see plan + usage.
      if (isOwner && billing) {
        summary.paid_through = billing.paid_through || null;
        summary.pending_change = billing.pending_change || null;
        summary.cancel_at_period_end = !!billing.cancel_at_period_end;
        summary.legacy_access = !!billing.legacy_access;
        summary.last_sync_at = billing.last_sync_at || null;
      }
      return ok({ summary });
    }

    // ---- startTrial: owner only, explicit, one per workspace + one per owner ----
    if (action === "startTrial") {
      const { user } = await requireMembership(base44, body.workspace_id, ["owner"]);
      // No existing billing record for this workspace.
      const existing = firstRecord(
        await sr.entities.WorkspaceBilling.filter({
          workspace_id: body.workspace_id,
          environment: ENV,
        })
      );
      if (existing) {
        return err(
          409,
          existing.status === "trial"
            ? "A trial already exists for this workspace"
            : "This workspace already has a billing record"
        );
      }
      // One trial per verified owner across workspaces they own.
      const owned = asArray(
        await sr.entities.Membership.filter({
          user_id: user.id,
          role: "owner",
          status: "active",
        })
      );
      const otherOwnedIds = owned
        .map((m) => m.workspace_id)
        .filter((id) => id !== body.workspace_id);
      if (otherOwnedIds.length) {
        const prior = asArray(
          await sr.entities.WorkspaceBilling.filter({
            workspace_id: { $in: otherOwnedIds },
            environment: ENV,
            status: "trial",
          })
        );
        if (prior.length) {
          return err(
            409,
            "You've already started a trial on another workspace. Choose a paid plan instead."
          );
        }
      }
      const now = new Date().toISOString();
      const billing = await sr.entities.WorkspaceBilling.create({
        workspace_id: body.workspace_id,
        environment: ENV,
        status: "trial",
        trial_started_at: now,
        trial_ends_at: trialEndDate(now),
        catalog_version: CATALOG_VERSION,
        legacy_access: false,
      });
      // Provision usage windows up-front so the first burst of metered actions
      // cannot race window creation.
      try {
        const { provisionWindows } = await import("../../shared/usage.ts");
        await provisionWindows(sr, billing, body.workspace_id);
      } catch {}
      return ok({ billing });
    }

    // ---- getUsage ----
    if (action === "getUsage") {
      await requireMembership(base44, body.workspace_id);
      const billing = firstRecord(
        await sr.entities.WorkspaceBilling.filter({
          workspace_id: body.workspace_id,
          environment: ENV,
        })
      );
      const usage = await computeUsage(sr, body.workspace_id, billing);
      return ok({ usage });
    }

    return err(400, `Unknown action: ${action}`);
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}

// Compute usage meters for a workspace. Live funnels, team users, and
// contacts are counted from their source entities. Email/AI/image meters
// read the UsageWindow for the current window (trial period or paid month);
// before the enforcement phase wires reservations, used=0 is accurate.
async function computeUsage(sr, workspaceId, billing) {
  const isTrial = billing && billing.status === "trial";
  const isPaid = billing && billing.status === "paid";
  const plan = billing?.plan ? getPlan(billing.plan) : null;
  const allowanceSource = isTrial
    ? TRIAL.allowances
    : isPaid && plan
      ? plan.allowances
      : null;

  // Live funnels: active published funnels.
  let liveFunnels = 0;
  try {
    liveFunnels = await sr.entities.Funnel.count({
      workspace_id: workspaceId,
      state: "published",
    });
  } catch {
    liveFunnels = 0;
  }

  // Team users: active members + unexpired pending invitations (seats reserved).
  let activeMembers = 0;
  try {
    activeMembers = await sr.entities.Membership.count({
      workspace_id: workspaceId,
      status: "active",
    });
  } catch {
    activeMembers = 0;
  }
  const pendingInvites = asArray(
    await sr.entities.Invite.filter({
      workspace_id: workspaceId,
      status: "pending",
    })
  );
  const now = Date.now();
  const unexpiredInvites = pendingInvites.filter(
    (iv) => !iv.expires_at || new Date(iv.expires_at).getTime() > now
  ).length;
  const teamUsers = activeMembers + unexpiredInvites;

  // Stored contacts: distinct Contact records (including archived).
  let contacts = 0;
  try {
    contacts = await sr.entities.Contact.count({ workspace_id: workspaceId });
  } catch {
    contacts = 0;
  }

  const meters = {
    live_funnels: {
      used: liveFunnels,
      allowance: allowanceSource ? allowanceSource.live_funnels : null,
    },
    team_users: {
      used: teamUsers,
      allowance: allowanceSource ? allowanceSource.team_users : null,
    },
    contacts: {
      used: contacts,
      allowance: allowanceSource ? allowanceSource.contacts : null,
    },
  };

  // Metered usage (email / AI text / images) from UsageWindow.
  const metered = isTrial
    ? [
        ["email_sends", "email_sends_total"],
        ["ai_text_actions", "ai_text_actions_total"],
        ["images", "images_total"],
      ]
    : [
        ["email_sends", "email_sends_per_month"],
        ["ai_text_actions", "ai_text_actions_per_month"],
        ["images", "images_per_month"],
      ];

  let resetDate = null;
  for (const [metric, allowanceKey] of metered) {
    const window = usageWindowFor(billing, metric);
    let used = 0;
    let reserved = 0;
    let windowInfo = null;
    if (window) {
      const w = firstRecord(
        await sr.entities.UsageWindow.filter({
          workspace_id: workspaceId,
          metric,
          window_start: window.start,
          window_end: window.end,
        })
      );
      used = w?.used || 0;
      reserved = w?.reserved || 0;
      windowInfo = { start: window.start, end: window.end };
      if (!resetDate || new Date(window.end).getTime() < new Date(resetDate).getTime()) {
        resetDate = window.end;
      }
    }
    meters[metric] = {
      used,
      reserved,
      allowance: allowanceSource ? allowanceSource[allowanceKey] : null,
      window: windowInfo,
    };
  }

  // Trial reset is the trial end; paid reset is the current monthly window end.
  if (isTrial && billing?.trial_ends_at) resetDate = billing.trial_ends_at;

  return { meters, reset_date: resetDate };
}