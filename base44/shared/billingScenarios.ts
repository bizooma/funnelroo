// At-capacity retry scenarios, run against the REAL customer handler
// (generateAudiencePortrait) with a controlled mock image provider.
//
// These exercise the acceptance cases that a small concurrent burst does not:
// a retried operation that must recover its original result without generating
// again or spending another unit, a genuinely new operation rejected BEFORE the
// provider is called, identity conflicts, lost-response recovery, reservation
// survival across a period rollover, and concurrent first use when the usage
// window does not exist yet.
//
// Everything is scoped to an explicitly designated test workspace
// (enforcement_enabled) and is cleaned up afterwards. A request blocked by the
// platform's own entity-write throttle is reported as `throttled`, never as
// evidence that a plan cap rejected it.

import type { Row, ServiceRoleClient } from "./models.ts";
import { firstRecord, asArray } from "./auth.ts";
import { provisionWindows, reserveUsage } from "./usage.ts";
import { beginMeteredAction } from "./enforce.ts";
import { ENVIRONMENT } from "./stripeCatalog.ts";
import { createMockImageProvider, generateAudiencePortrait, type VisualPreferences } from "./personaPortrait.ts";

export interface ScenarioResult {
  name: string;
  pass: boolean;
  detail?: Record<string, unknown>;
}

export interface ScenarioReport {
  workspace_id: string;
  scenarios: ScenarioResult[];
  passed: number;
  failed: number;
  throttled: boolean;
  cleanup: Record<string, number>;
}

const PREFS: VisualPreferences = { style: "photo", background: "workplace", appearance: "" };
const IMAGE_METRIC = "images";

function isThrottle(e: unknown): boolean {
  return /rate limit|too many requests|429/i.test(String((e as { message?: string })?.message || e));
}

async function latestWindow(sr: ServiceRoleClient, workspaceId: string, metric: string): Promise<Row | null> {
  const rows = asArray<Row>(
    (await sr.entities.UsageWindow.filter(
      { workspace_id: workspaceId, metric },
      { sort: "-created_date", limit: 1 }
    )) as Row[]
  );
  return rows[0] || null;
}

async function operationRow(sr: ServiceRoleClient, workspaceId: string, key: string): Promise<Row | null> {
  const rows = asArray<Row>(
    (await sr.entities.UsageOperation.filter({
      workspace_id: workspaceId,
      operation_key: key,
    })) as Row[]
  );
  return rows[0] || null;
}

export async function runRetryScenarios(
  sr: ServiceRoleClient,
  args: { workspaceId: string; userId: string }
): Promise<ScenarioReport> {
  const ws = args.workspaceId;
  const scenarios: ScenarioResult[] = [];
  let throttled = false;
  const cleanupCounts: Record<string, number> = {};
  const createdAudienceIds: string[] = [];

  const record = (name: string, pass: boolean, detail?: Record<string, unknown>) =>
    scenarios.push({ name, pass, detail });

  // --- Designated test workspace: active enforced trial (images_total = 3) ---
  let billing = firstRecord<Row>(
    (await sr.entities.WorkspaceBilling.filter({
      workspace_id: ws,
      environment: ENVIRONMENT,
    })) as Row[]
  );
  const now = new Date();
  const trialFields = {
    status: "trial",
    trial_started_at: now.toISOString(),
    trial_ends_at: new Date(now.getTime() + 14 * 86400000).toISOString(),
    enforcement_enabled: true,
    legacy_access: false,
  };
  billing = billing
    ? await sr.entities.WorkspaceBilling.update(billing.id, trialFields)
    : await sr.entities.WorkspaceBilling.create({
        workspace_id: ws,
        environment: ENVIRONMENT,
        ...trialFields,
      });

  // Start from a clean usage state so the image allowance is exactly 3.
  await sr.entities.UsageOperation.deleteMany({ workspace_id: ws });
  await sr.entities.UsageWindow.deleteMany({ workspace_id: ws });
  await sr.entities.PersonaPortraitRequest.deleteMany({ workspace_id: ws });
  await provisionWindows(sr, billing, ws);

  const provider = createMockImageProvider();
  const audiences: Row[] = [];
  for (let i = 1; i <= 4; i++) {
    const a = await sr.entities.Audience.create({
      workspace_id: ws,
      name: `Retry scenario audience ${i}`,
      roles_industries: "independent consultant",
      status: "draft",
      approved: false,
    });
    audiences.push(a);
    createdAudienceIds.push(a.id);
  }

  const gen = async (index: number, requestId: string) =>
    await generateAudiencePortrait({
      sr,
      workspaceId: ws,
      audience: audiences[index],
      prefs: PREFS,
      userId: args.userId,
      requestId,
      provider,
    });

  // --- A. Three distinct logical image operations ---
  const first: Array<Awaited<ReturnType<typeof gen>>> = [];
  try {
    for (let i = 0; i < 3; i++) first.push(await gen(i, `scenario_op${i + 1}`));
    const win = await latestWindow(sr, ws, IMAGE_METRIC);
    record(
      "A_three_distinct_operations",
      first.every((o) => o.ok && o.generated === true) &&
        provider.calls === 3 &&
        (win?.used ?? 0) === 3,
      {
        generated: first.filter((o) => o.generated).length,
        provider_calls: provider.calls,
        used: win?.used ?? 0,
      }
    );
  } catch (e) {
    throttled = throttled || isThrottle(e);
    record("A_three_distinct_operations", false, {
      throttled: isThrottle(e),
      error: String((e as { message?: string })?.message || e),
    });
  }

  const thirdUrl = first[2]?.request?.candidate_url;
  const thirdRequestId = first[2]?.request?.request_id;

  // --- B/C. Retry the THIRD operation (same request id + same payload) ---
  // Must recover the original result/state: no regeneration, no extra unit, and
  // no quota-exhausted rejection even though the allowance is fully used.
  try {
    const callsBefore = provider.calls;
    const retry = await gen(2, "scenario_op3");
    const win = await latestWindow(sr, ws, IMAGE_METRIC);
    record(
      "C_retry_recovers_original_result",
      retry.ok === true &&
        retry.generated === false &&
        provider.calls === callsBefore &&
        retry.request?.candidate_url === thirdUrl &&
        retry.request?.request_id === thirdRequestId &&
        (win?.used ?? 0) === 3,
      {
        recovered_same_url: retry.request?.candidate_url === thirdUrl,
        provider_calls: provider.calls,
        used: win?.used ?? 0,
        status: retry.status,
      }
    );
  } catch (e) {
    throttled = throttled || isThrottle(e);
    record("C_retry_recovers_original_result", false, {
      throttled: isThrottle(e),
      error: String((e as { message?: string })?.message || e),
    });
  }

  // --- D/E. A fourth, genuinely NEW operation is rejected BEFORE the provider ---
  try {
    const callsBefore = provider.calls;
    const fourth = await gen(3, "scenario_op4");
    const requestsForFourth = asArray<Row>(
      (await sr.entities.PersonaPortraitRequest.filter({
        audience_id: audiences[3].id,
      })) as Row[]
    );
    const win = await latestWindow(sr, ws, IMAGE_METRIC);
    const limitReason = (fourth.limit as { limit?: { reason?: string } } | undefined)?.limit?.reason;
    record(
      "E_fourth_operation_rejected_before_provider",
      fourth.ok === false &&
        limitReason === "limit_reached" &&
        provider.calls === callsBefore &&
        requestsForFourth.length === 0 &&
        (win?.used ?? 0) === 3,
      {
        status: fourth.status,
        limit_reason: limitReason ?? null,
        provider_calls: provider.calls,
        requests_created: requestsForFourth.length,
        used: win?.used ?? 0,
      }
    );
  } catch (e) {
    throttled = throttled || isThrottle(e);
    record("E_fourth_operation_rejected_before_provider", false, {
      throttled: isThrottle(e),
      error: String((e as { message?: string })?.message || e),
    });
  }

  // --- F. Same operation key with a DIFFERENT payload is a conflict ---
  try {
    const conflict = await beginMeteredAction(sr, {
      workspaceId: ws,
      action: "generatePersonaPortrait",
      metric: "image",
      operationKey: "generatePersonaPortrait:scenario_op1",
      payload: {
        audience_id: audiences[0].id,
        visual_preferences: { style: "illustration", background: "studio", appearance: "" },
      },
    });
    record(
      "F_same_key_different_payload_rejected",
      conflict.allowed === false && conflict.report?.reason === "operation_conflict",
      { reason: conflict.report?.reason ?? null }
    );
  } catch (e) {
    throttled = throttled || isThrottle(e);
    record("F_same_key_different_payload_rejected", false, {
      throttled: isThrottle(e),
      error: String((e as { message?: string })?.message || e),
    });
  }

  // --- G. Lost response after a provider success recovers safely ---
  // The unit for operation 2 is already consumed and its request is recorded as
  // ready. Re-issuing the same identity must return the recorded image without
  // calling the provider or spending another unit.
  try {
    const callsBefore = provider.calls;
    const secondUrl = first[1]?.request?.candidate_url;
    const recovered = await gen(1, "scenario_op2");
    const win = await latestWindow(sr, ws, IMAGE_METRIC);
    record(
      "G_lost_response_recovers",
      recovered.ok === true &&
        recovered.generated === false &&
        provider.calls === callsBefore &&
        recovered.request?.candidate_url === secondUrl &&
        (win?.used ?? 0) === 3,
      { provider_calls: provider.calls, used: win?.used ?? 0 }
    );
  } catch (e) {
    throttled = throttled || isThrottle(e);
    record("G_lost_response_recovers", false, {
      throttled: isThrottle(e),
      error: String((e as { message?: string })?.message || e),
    });
  }

  // --- H. An old operation retried after the period boundary ---
  // The retry must stay tied to its ORIGINAL reservation and must not spend the
  // new period's allowance.
  let originalWindowId: string | null = null;
  try {
    const op1 = await operationRow(sr, ws, "generatePersonaPortrait:scenario_op1");
    originalWindowId = (op1?.window_id as string) || null;

    // Roll the trial into a NEW period.
    const rollStart = new Date(Date.now() + 30 * 86400000);
    await sr.entities.WorkspaceBilling.update(billing.id, {
      trial_started_at: rollStart.toISOString(),
      trial_ends_at: new Date(rollStart.getTime() + 14 * 86400000).toISOString(),
    });
    const rolled = firstRecord<Row>(
      (await sr.entities.WorkspaceBilling.filter({
        workspace_id: ws,
        environment: ENVIRONMENT,
      })) as Row[]
    );
    await provisionWindows(sr, rolled, ws);

    const retryOld = await gen(0, "scenario_op1");
    const newWindow = await latestWindow(sr, ws, IMAGE_METRIC);
    record(
      "H_old_operation_after_boundary",
      retryOld.ok === true &&
        retryOld.generated === false &&
        (newWindow?.id || null) !== originalWindowId &&
        (newWindow?.used ?? 0) === 0,
      {
        original_window_preserved: !!originalWindowId,
        new_window_used: newWindow?.used ?? 0,
        provider_calls: provider.calls,
      }
    );
  } catch (e) {
    throttled = throttled || isThrottle(e);
    record("H_old_operation_after_boundary", false, {
      throttled: isThrottle(e),
      error: String((e as { message?: string })?.message || e),
    });
  }

  // --- I. The rollover created a new window without erasing the old one ---
  try {
    const all = asArray<Row>(
      (await sr.entities.UsageWindow.filter({
        workspace_id: ws,
        metric: IMAGE_METRIC,
      })) as Row[]
    );
    const old = all.find((w) => w.id === originalWindowId);
    const fresh = all.find((w) => w.id !== originalWindowId);
    record(
      "I_rollover_preserves_old_window",
      all.length >= 2 && !!old && (old?.used ?? 0) === 3 && !!fresh && (fresh?.used ?? 0) === 0,
      {
        windows: all.length,
        old_window_used: old?.used ?? null,
        new_window_used: fresh?.used ?? 0,
      }
    );
  } catch (e) {
    throttled = throttled || isThrottle(e);
    record("I_rollover_preserves_old_window", false, {
      throttled: isThrottle(e),
      error: String((e as { message?: string })?.message || e),
    });
  }

  // --- J. Concurrent first use when the window does not exist yet ---
  // Delete the image windows, then fire a simultaneous burst. The window must be
  // created exactly once and never split, and the cap must still hold.
  try {
    await sr.entities.UsageWindow.deleteMany({ workspace_id: ws, metric: IMAGE_METRIC });

    const N = 6;
    const burst = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        reserveUsage(sr, {
          workspaceId: ws,
          metric: "image",
          operationKey: `scenario_firstuse_${Date.now()}_${i}`,
          payloadFingerprint: `firstuse_${i}`,
        }).catch((e) => ({ allowed: false, reason: isThrottle(e) ? "throttled" : "error" }))
      )
    );
    const admitted = burst.filter((b) => b.allowed && !b.duplicate).length;
    const capacityRejections = burst.filter(
      (b) => !b.allowed && b.reason === "limit_reached"
    ).length;
    const throttledInBurst = burst.filter((b) => b.reason === "throttled").length;
    if (throttledInBurst) throttled = true;

    const windows = asArray<Row>(
      (await sr.entities.UsageWindow.filter({
        workspace_id: ws,
        metric: IMAGE_METRIC,
      })) as Row[]
    );
    record(
      "J_concurrent_first_use_single_window",
      admitted === 3 && capacityRejections === 3 && windows.length === 1,
      {
        concurrency: N,
        admitted,
        capacity_rejections: capacityRejections,
        throttled_in_burst: throttledInBurst,
        window_rows: windows.length,
      }
    );
  } catch (e) {
    throttled = throttled || isThrottle(e);
    record("J_concurrent_first_use_single_window", false, {
      throttled: isThrottle(e),
      error: String((e as { message?: string })?.message || e),
    });
  }

  // --- Cleanup: leave the designated test workspace tidy ---
  cleanupCounts.usage_operations = await countThenDelete(sr, "UsageOperation", { workspace_id: ws });
  cleanupCounts.usage_windows = await countThenDelete(sr, "UsageWindow", { workspace_id: ws });
  cleanupCounts.portrait_requests = await countThenDelete(sr, "PersonaPortraitRequest", { workspace_id: ws });
  for (const id of createdAudienceIds) {
    try {
      await sr.entities.Audience.delete(id);
    } catch {
      // already removed
    }
  }
  cleanupCounts.audiences = createdAudienceIds.length;

  return {
    workspace_id: ws,
    scenarios,
    passed: scenarios.filter((s) => s.pass).length,
    failed: scenarios.filter((s) => !s.pass).length,
    throttled,
    cleanup: cleanupCounts,
  };
}

async function countThenDelete(
  sr: ServiceRoleClient,
  entity: string,
  query: Row
): Promise<number> {
  const rows = asArray<Row>((await sr.entities[entity].filter(query)) as Row[]);
  try {
    await sr.entities[entity].deleteMany(query);
  } catch {
    // best effort
  }
  return rows.length;
}