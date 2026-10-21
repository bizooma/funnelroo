import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { requireMembership, firstRecord, ok, err, HttpError } from "../../shared/auth.ts";
import {
  getStripeClient,
  assertTestMode,
  isStripeConfigured,
  StripeConfigError,
} from "../../shared/stripeClient.ts";
import { ENVIRONMENT } from "../../shared/stripeCatalog.ts";
import { billingSettingsUrl, customerOrigin } from "../../shared/appOrigins.ts";

// Owner-only Stripe Customer Portal. Lets the owner manage payment method,
// view invoices, change plan, and cancel — all on Stripe's hosted page.
// Fail-closed with no valid test key.

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    await requireMembership(base44, body.workspace_id, ["owner"]);

    if (!isStripeConfigured()) {
      return err(503, "Stripe is not configured yet. Billing management is unavailable.");
    }
    assertTestMode();

    const billing = firstRecord(
      await sr.entities.WorkspaceBilling.filter({
        workspace_id: body.workspace_id,
        environment: ENVIRONMENT,
      })
    );
    if (!billing?.stripe_customer_id) {
      return err(409, "No billing account exists for this workspace yet.");
    }

    const stripe = getStripeClient();
    // Canonical customer-facing destination: the configured site, never a
    // backend function host and never an unvalidated browser value.
    const portal = await stripe.billingPortal.sessions.create({
      customer: billing.stripe_customer_id,
      return_url: billingSettingsUrl(customerOrigin(body.origin)),
    });
    return ok({ url: portal.url });
  } catch (e) {
    if (e instanceof StripeConfigError) return err(503, e.message);
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}