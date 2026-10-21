import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import {
  requireMembership,
  requireUser,
  firstRecord,
  asArray,
  isPlatformOperator,
  ok,
  err,
  HttpError,
} from "../../shared/auth.ts";
import {
  getStripeClient,
  isStripeConfigured,
  StripeConfigError,
  verifyStripeCredential,
  stripeRequestApiVersion,
  STRIPE_SDK_VERSION,
} from "../../shared/stripeClient.ts";
import {
  PRICE_LOOKUP,
  keyFor,
  expectedTerms,
  validatePrice,
  ENVIRONMENT,
  CATALOG_PIN,
} from "../../shared/stripeCatalog.ts";
import { PLANS } from "../../shared/plans.ts";
import { runSyncFixtures, runPriceFixtures } from "../../shared/stripeMock.ts";
import { reserveUsage, consumeUsage, releaseUsage, provisionWindows } from "../../shared/usage.ts";
import { runRetryScenarios } from "../../shared/billingScenarios.ts";
import {
  canonicalOrigin,
  previewOrigins,
  customerOrigin,
  billingReturnUrl,
  billingSettingsUrl,
} from "../../shared/appOrigins.ts";

// Billing administration for the platform operator (app owner):
//  - provisionCatalog: create/reuse the two Products and four recurring Prices,
//    validating amounts, currency, and interval against the approved catalog.
//  - validateCatalog: read-only check of the live test prices vs. the catalog.
//  - setEnforcement: designate/undesignate a workspace for enforcement (test).
//  - legacyDryRun: report-only migration preview. Makes NO changes.
//  - selfTest: run the real mapping/validation + usage reservation logic against
//    fixtures (no live keys needed) and report results.
//
// Every action requires an authenticated platform operator. Live keys are
// rejected by the adapter.

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const user = await requireUser(base44);
    if (!isPlatformOperator(user)) return err(403, "Platform operator access required");
    const action = body.action;

    // --- Validate the configured credential (read-only, non-mutating) ---
    // Distinguishes a missing/placeholder value, an unsupported type, a rejected
    // or expired key, a valid restricted key missing a permission, and a live key
    // refused because this rollout is test-only. Never returns the key itself.
    if (action === "verifyCredentials") {
      const result = await verifyStripeCredential();
      return ok({
        ...result,
        sdk_version: STRIPE_SDK_VERSION,
        webhook_endpoint_path: "/functions/stripeWebhook",
        webhook_api_version: result.api_version,
        webhook_note:
          "In the Stripe TEST dashboard, add the webhook destination for /functions/stripeWebhook and pin its API version to webhook_api_version so delivered events match the handler's payload shape.",
      });
    }

    // --- Report the customer-facing origins and the URLs we build (read-only) ---
    // Confirms the configured canonical site and that no input — missing, a
    // backend-host alias, www, or an arbitrary value — resolves anywhere else.
    if (action === "returnUrls") {
      const samples = [
        { requested: "missing", value: undefined },
        { requested: "canonical", value: canonicalOrigin() },
        { requested: "backend_host_alias", value: "https://funnel-roo-flow.base44.app" },
        { requested: "www_alias", value: "https://www.funnelroo.com" },
        { requested: "arbitrary", value: "https://evil.example.com" },
      ];
      return ok({
        canonical_origin: canonicalOrigin(),
        preview_origins: previewOrigins(),
        checkout_destinations: samples.map((s) => ({
          requested: s.requested,
          resolved_origin: customerOrigin(s.value),
          success_url: billingReturnUrl(s.value),
          cancel_url: billingSettingsUrl(s.value),
        })),
        portal_return_url: billingSettingsUrl(undefined),
      });
    }

    // --- At-capacity retry scenarios (designated test workspace only) ---
    if (action === "retryScenarios") {
      const wsId = String(body.test_workspace_id || "").trim();
      if (!wsId) return err(400, "test_workspace_id is required");
      const existing = firstRecord(
        await sr.entities.WorkspaceBilling.filter({ workspace_id: wsId, environment: ENVIRONMENT })
      );
      if (!existing || existing.enforcement_enabled !== true) {
        return err(
          403,
          "The retry scenarios run only on a workspace already designated for enforcement."
        );
      }
      const report = await runRetryScenarios(sr, { workspaceId: wsId, userId: user.id });
      return ok(report);
    }

    // --- Provision / validate the Stripe catalog ---
    if (action === "provisionCatalog" || action === "validateCatalog") {
      if (!isStripeConfigured()) {
        return err(503, "Stripe is not configured. Set STRIPE_SECRET_KEY (test mode) first.");
      }
      const stripe = getStripeClient();
      const report = [];
      for (const planId of Object.keys(PLANS)) {
        for (const interval of ["monthly", "annual"]) {
          const lookupKey = keyFor(planId, interval);
          const exp = expectedTerms(planId, interval);
          const existing = (
            await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
          ).data?.[0];
          if (existing) {
            const v = validatePrice(existing, planId, interval);
            report.push({ plan: planId, interval, lookup_key: lookupKey, action: "found", valid: v.valid, reason: v.reason || null, price_id: existing.id });
            continue;
          }
          if (action === "validateCatalog") {
            report.push({ plan: planId, interval, lookup_key: lookupKey, action: "missing", valid: false });
            continue;
          }
          // Create product + price (idempotent on lookup_key absence).
          const product = await stripe.products.create({
            name: `FunnelRoo ${PLANS[planId].name}`,
            metadata: { app: "funnelroo", plan: planId, environment: ENVIRONMENT },
          });
          const price = await stripe.prices.create({
            product: product.id,
            currency: exp.currency,
            unit_amount: exp.amount,
            recurring: { interval: exp.recurring },
            lookup_key: lookupKey,
            metadata: { app: "funnelroo", plan: planId, interval, environment: ENVIRONMENT },
          });
          report.push({ plan: planId, interval, lookup_key: lookupKey, action: "created", valid: true, price_id: price.id, product_id: product.id });
        }
      }
      return ok({ catalog_pin: CATALOG_PIN, report });
    }

    // --- Designate a workspace for enforcement (test workspaces only) ---
    if (action === "setEnforcement") {
      const enabled = body.enabled === true;
      const billing = firstRecord(
        await sr.entities.WorkspaceBilling.filter({
          workspace_id: body.workspace_id,
          environment: ENVIRONMENT,
        })
      );
      if (!billing) {
        if (!enabled) return ok({ workspace_id: body.workspace_id, enforcement_enabled: false });
        const created = await sr.entities.WorkspaceBilling.create({
          workspace_id: body.workspace_id,
          environment: ENVIRONMENT,
          status: "read_only",
          enforcement_enabled: true,
          legacy_access: false,
        });
        return ok({ workspace_id: body.workspace_id, enforcement_enabled: true, billing_id: created.id });
      }
      await sr.entities.WorkspaceBilling.update(billing.id, { enforcement_enabled: enabled });
      return ok({ workspace_id: body.workspace_id, enforcement_enabled: enabled });
    }

    // --- Legacy-access migration DRY RUN (no writes) ---
    if (action === "legacyDryRun") {
      const workspaces = asArray(await sr.entities.Workspace.list());
      const billings = asArray(
        await sr.entities.WorkspaceBilling.filter({ environment: ENVIRONMENT })
      );
      const byWs = new Map(billings.map((b) => [b.workspace_id, b]));
      const plan = workspaces.map((w) => {
        const b = byWs.get(w.id);
        let classification;
        if (!b) classification = "no_record_no_enforcement";
        else if (b.legacy_access) classification = "explicit_legacy_access";
        else if (b.enforcement_enabled) classification = "designated_test_workspace";
        else if (b.plan) classification = "active_paid";
        else classification = "record_without_plan";
        return {
          workspace_id: w.id,
          workspace_name: w.name,
          current: b ? { status: b.status, plan: b.plan || null, legacy_access: !!b.legacy_access, enforcement_enabled: !!b.enforcement_enabled } : null,
          proposed: { legacy_access: classification === "no_record_no_enforcement", enforcement_enabled: false },
          classification,
        };
      });
      return ok({
        mode: "dry_run",
        changes_made: 0,
        total_workspaces: plan.length,
        summary: plan.reduce((acc, p) => ((acc[p.classification] = (acc[p.classification] || 0) + 1), acc), {}),
        plan,
      });
    }

    // --- Self-test: real mapping + validation + usage reservations on fixtures ---
    if (action === "selfTest") {
      const syncResults = body.include_fixtures === false ? [] : runSyncFixtures();
      const priceResults = body.include_fixtures === false ? [] : runPriceFixtures();

      // Live usage reservation concurrency test ONLY on a designated test
      // workspace (enforcement_enabled). Makes bounded writes and cleans up.
      let usageResult = { ran: false, reason: "no_test_workspace_provided" };
      if (body.test_workspace_id) {
        // Provision/refresh a designated TEST billing (active trial + enforcement)
        // so the REAL usage handler and persistence layer are exercised. Scoped
        // strictly to the explicitly provided test workspace id.
        let billing = firstRecord(
          await sr.entities.WorkspaceBilling.filter({
            workspace_id: body.test_workspace_id,
            environment: ENVIRONMENT,
          })
        );
        const trialEnds = new Date(Date.now() + 14 * 86400000).toISOString();
        if (!billing) {
          billing = await sr.entities.WorkspaceBilling.create({
            workspace_id: body.test_workspace_id,
            environment: ENVIRONMENT,
            status: "trial",
            trial_started_at: new Date().toISOString(),
            trial_ends_at: trialEnds,
            enforcement_enabled: true,
            legacy_access: false,
            catalog_version: CATALOG_PIN.catalog_version,
          });
        } else {
          billing = await sr.entities.WorkspaceBilling.update(billing.id, {
            status: "trial",
            trial_started_at: billing.trial_started_at || new Date().toISOString(),
            trial_ends_at: trialEnds,
            enforcement_enabled: true,
          });
        }
        {
          // Provision the usage windows BEFORE the burst so window creation
          // cannot race (matches trial/paid activation behavior).
          await provisionWindows(sr, billing, body.test_workspace_id);
          const stamp = Date.now();

          // --- Idempotency (checked first, while capacity is free) ---
          const k = `selftest_idem_${stamp}`;
          const first = await reserveUsage(sr, { workspaceId: body.test_workspace_id, metric: "image", operationKey: k });
          const second = await reserveUsage(sr, { workspaceId: body.test_workspace_id, metric: "image", operationKey: k });
          if (first.operation_id) await releaseUsage(sr, { workspaceId: body.test_workspace_id, operationId: first.operation_id }).catch(() => {});

          // --- Concurrent burst against the (small) image cap ---
          const N = body.concurrency || 6;
          const attempts = await Promise.all(
            Array.from({ length: N }, (_, i) =>
              reserveUsage(sr, {
                workspaceId: body.test_workspace_id,
                metric: "image",
                operationKey: `selftest_${stamp}_${i}`,
                sourceRef: "selfTest",
              }).catch((e) => ({ allowed: false, error: String(e?.message || e) }))
            )
          );
          const admitted = attempts.filter((a) => a.allowed && !a.duplicate).length;
          const rejected = attempts.filter((a) => !a.allowed).length;
          // Consume admitted reservations so capacity is truly used during the
          // burst (a release would free a slot — a test artifact).
          for (const a of attempts) {
            if (a.allowed && !a.duplicate && a.operation_id) {
              await consumeUsage(sr, { workspaceId: body.test_workspace_id, operationId: a.operation_id }).catch(() => {});
            }
          }
          // Reset the designated test workspace's usage state.
          await sr.entities.UsageOperation.deleteMany({ workspace_id: body.test_workspace_id }).catch(() => {});
          await sr.entities.UsageWindow.deleteMany({ workspace_id: body.test_workspace_id }).catch(() => {});
          usageResult = {
            ran: true,
            workspace_id: body.test_workspace_id,
            concurrency: N,
            admitted,
            rejected,
            idempotent_second_call: second.duplicate === true,
            note: "Idempotency verified; burst capped at the allowance; test workspace usage reset after.",
          };
        }
      }

      return ok({
        sync_fixtures: { pass: syncResults.every((r) => r.pass), results: syncResults },
        price_fixtures: { pass: priceResults.every((r) => r.pass), results: priceResults },
        usage_concurrency: usageResult,
      });
    }

    return err(400, `Unknown action: ${action}`);
  } catch (e) {
    if (e instanceof StripeConfigError) return err(503, e.message);
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}