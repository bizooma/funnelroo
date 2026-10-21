import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import {
  firstRecord,
  asArray,
  ok,
  err,
} from "../../shared/auth.ts";
import {
  applyBookingStop,
  parseCalendlyEvent,
  enrichWithEventDetails,
  resolveBookingContext,
  determineAttribution,
  matchContact,
  ensureContactFromBooking,
  normalizeEmail,
  upsertBooking,
  resolveFunnelLead,
  linkRescheduleChain,
  getConnectionAccessToken,
  isCalendlyConfigured,
} from "../../shared/booking.ts";
import { runAppointmentCheck } from "../../shared/appointmentChecks.ts";
import { runBookingFixtures } from "../../shared/bookingFixtures.ts";

// Scheduled reconciliation: fetches scheduled events from the Calendly API for
// the lookback window, compares against stored Booking records, and processes
// any missed events (creates, cancellations) exactly like webhook events.
// Recovers from the last successful sync checkpoint, not just the default
// lookback. Releases outage holds only after catch-up and pending stops complete.
//
// Called by the BookingReconcile workflow every 15 minutes.

// Each invocation consumes bounded pages and persists unfinished work.
// Future appointment discovery has no maximum date.

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));

    // Trusted scheduler identity. The platform invokes this step AS the workflow's
    // creator, an app admin, so that admin session is the credential — no
    // caller-supplied flag is trusted or required. The URL is public, so this gate
    // is what keeps anonymous and customer-session callers out.
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      user = null;
    }
    if (!user) return err(401, "Authentication required.");
    if (user.role !== "admin") {
      return err(403, "Booking reconciliation is restricted to the platform operator.");
    }
    if (body.action === "verifyFixtures") {
      return ok(await runBookingFixtures(ingestCheckedAppointment));
    }

    const results = [];

    const connections = asArray(
      await sr.entities.CalendarConnection.filter({
        provider: "calendly",
        status: { $in: ["connected", "reconnect_required"] },
      })
    );

    for (const connection of connections) {
      try {
        const r = await reconcileConnection(sr, connection);
        results.push({ workspace_id: connection.workspace_id, ...r });
      } catch (e) {
        results.push({
          workspace_id: connection.workspace_id,
          error: String(e?.message || e),
        });
      }
    }

    return ok({ reconciled: results.length, results });
  } catch (e) {
    return err(500, e.message);
  }
}

async function reconcileConnection(sr, connection) {
  if (!isCalendlyConfigured()) return {complete: false, error: "not_configured"};
  const token = await getConnectionAccessToken(sr, connection.id);
  if (!token) {
    await sr.entities.CalendarConnection.update(connection.id, {
      booking_check_status: "failed", booking_check_error: "Authorization needs renewal",
      last_booking_check_attempt_at: new Date().toISOString(),
    });
    return {complete: false, error: "authorization_required"};
  }
  return runAppointmentCheck(sr, connection, token, (invitee, event) => ingestCheckedAppointment(sr, connection, invitee, event));
}

async function ingestCheckedAppointment(sr, connection, invitee, event) {
    const existing = firstRecord(await sr.entities.Booking.filter({
      workspace_id: connection.workspace_id, connection_id: connection.id, provider_invitee_uri: invitee.uri,
    }));
    const canceled = invitee.status === "canceled" || event.status === "canceled";
    if (canceled) {
      if (existing) await sr.entities.Booking.update(existing.id, {
        provider_state: "canceled", cancel_reason: invitee.cancellation?.reason || "",
        canceled_at: invitee.cancellation?.created_at || new Date().toISOString(),
      });
      if (invitee.new_invitee) await linkRescheduleChain(sr, connection.workspace_id, invitee.uri, invitee.new_invitee);
      return;
    }
    const parsed = {...parseCalendlyEvent({event: "invitee.created", payload: {...invitee, event: event.uri, event_type: event.event_type}}),
      start_time: event.start_time, end_time: event.end_time, event_title: event.name};
    if (!parsed.start_time || !parsed.end_time) throw new Error("Appointment details incomplete");
    await processReconciledCreate(sr, connection, connection.workspace_id, parsed, event);
    if (invitee.old_invitee) await linkRescheduleChain(sr, connection.workspace_id, invitee.old_invitee, invitee.uri);
}

// --- Process a reconciled create (same logic as webhook processInviteeCreated) ---
async function processReconciledCreate(sr, connection, workspaceId, parsed, event) {
  const token = String(parsed.tracking?.utm_content || "").trim();
  const ctxResult = await resolveBookingContext(sr, workspaceId, token, connection.id, "");
  const attribution = determineAttribution(ctxResult);
  const ctx = ctxResult?.valid ? ctxResult.context : null;

  let contact = await matchContact(sr, workspaceId, parsed.invitee_email);
  if (!contact && parsed.invitee_email) {
    contact = await ensureContactFromBooking(sr, workspaceId, parsed.invitee_email, parsed.invitee_name);
  }

  if (ctx?.contact_id && contact && ctx.contact_id !== contact.id) {
    attribution.status = "unattributed";
  }

  let leadId = "";
  if (attribution.status === "reliable" && contact) {
    const lead = await resolveFunnelLead(sr, workspaceId, contact.id, attribution.funnelId, "booking");
    leadId = lead?.id || "";
  }

  const booking = await upsertBooking(sr, workspaceId, {
    connection_id: connection.id,
    event_type_id: "",
    provider_event_uri: parsed.event_uri,
    provider_invitee_uri: parsed.invitee_uri,
    provider_event_uuid: parsed.event_uuid,
    provider_invitee_uuid: parsed.invitee_uuid,
    contact_id: contact?.id || "",
    funnel_id: attribution.funnelId || "",
    funnel_lead_id: leadId,
    booking_context_id: ctx?.id || "",
    invitee_email: parsed.invitee_email,
    invitee_email_normalized: normalizeEmail(parsed.invitee_email),
    invitee_name: parsed.invitee_name,
    invitee_timezone: parsed.invitee_timezone,
    event_title: parsed.event_title || event.name || "",
    start_time_utc: parsed.start_time,
    end_time_utc: parsed.end_time,
    cancel_url: parsed.cancel_url,
    reschedule_url: parsed.reschedule_url,
    provenance: "provider_confirmed",
    attribution_status: attribution.status,
    attribution_label: attribution.label,
    created_at_provider: parsed.created_at,
  });

  if (contact && !booking.nurture_stopped) {
    await applyBookingStop(sr, workspaceId, contact.id, booking.id, "system:reconcile");
  }

  if (ctx && ctx.id) {
    await sr.entities.BookingContext.update(ctx.id, {
      consumed_at: new Date().toISOString(),
      consumed_booking_id: booking.id,
    });
  }
}