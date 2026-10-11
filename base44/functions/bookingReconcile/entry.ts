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
  releaseOutageHold,
  getConnectionAccessToken,
  isCalendlyConfigured,
} from "../../shared/booking.ts";
import { secrets } from "base44:runtime";

// Scheduled reconciliation: fetches scheduled events from the Calendly API for
// the lookback window, compares against stored Booking records, and processes
// any missed events (creates, cancellations) exactly like webhook events.
// Recovers from the last successful sync checkpoint, not just the default
// lookback. Releases outage holds only after catch-up and pending stops complete.
//
// Called by the BookingReconcile workflow every 15 minutes.

const DEFAULT_LOOKBACK_HOURS = 24;
const MAX_LOOKBACK_HOURS = 720; // 30 days max recovery window
const API_PAGE_SIZE = 50;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));

    // This is a scheduled function — verify it's called by the workflow system
    const isSystem = body._system === true || body._workflow === true;
    if (!isSystem) {
      return err(403, "Reconciliation must be triggered by the scheduled workflow");
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
  const workspaceId = connection.workspace_id;
  let processed = 0;
  let errors = 0;

  if (!isCalendlyConfigured()) {
    await sr.entities.CalendarConnection.update(connection.id, {
      last_sync_at: new Date().toISOString(),
      last_sync_status: "success",
      last_sync_cursor: new Date().toISOString(),
      last_sync_error: "",
    });
    return { processed: 0, mock: true };
  }

  // Determine lookback from last successful sync checkpoint
  let lookbackStart;
  if (connection.last_sync_at && connection.last_sync_cursor && connection.last_sync_status === "success") {
    lookbackStart = new Date(connection.last_sync_cursor);
  } else {
    lookbackStart = new Date(Date.now() - DEFAULT_LOOKBACK_HOURS * 3600 * 1000);
  }

  const maxLookback = new Date(Date.now() - MAX_LOOKBACK_HOURS * 3600 * 1000);
  if (lookbackStart < maxLookback) lookbackStart = maxLookback;
  const lookbackEnd = new Date();

  const accessToken = await getConnectionAccessToken(sr, connection.id);
  if (!accessToken) {
    await sr.entities.CalendarConnection.update(connection.id, {
      last_sync_status: "failed",
      last_sync_error: "No valid access token — reconnect required",
    });
    return { processed: 0, errors: 1, error: "no_token" };
  }

  // Fetch scheduled events (active and canceled) from Calendly API
  const userUri = connection.provider_user_uri;
  const minStart = lookbackStart.toISOString();
  const maxStart = lookbackEnd.toISOString();

  // Fetch active events
  const activeEvents = await fetchAllScheduledEvents(accessToken, userUri, minStart, maxStart, "active");
  // Fetch canceled events
  const canceledEvents = await fetchAllScheduledEvents(accessToken, userUri, minStart, maxStart, "canceled");

  // Process each active event's invitees
  for (const event of activeEvents) {
    try {
      const invitees = await fetchEventInvitees(accessToken, event.uri);
      for (const invitee of invitees) {
        const existing = firstRecord(
          await sr.entities.Booking.filter({
            workspace_id: workspaceId,
            connection_id: connection.id,
            provider_invitee_uri: invitee.uri,
          })
        );
        if (!existing) {
          // Missed create — process it
          const fakePayload = {
            event: "invitee.created",
            payload: { ...invitee, event: event.uri, event_type: event.event_type },
          };
          const parsed = parseCalendlyEvent(fakePayload);
          const enriched = await enrichWithEventDetails(parsed, accessToken);
          await processReconciledCreate(sr, connection, workspaceId, enriched, event);
          processed++;
        }
      }
    } catch (e) {
      errors++;
    }
  }

  // Process canceled events we missed
  for (const event of canceledEvents) {
    try {
      const invitees = await fetchEventInvitees(accessToken, event.uri);
      for (const invitee of invitees) {
        const booking = firstRecord(
          await sr.entities.Booking.filter({
            workspace_id: workspaceId,
            connection_id: connection.id,
            provider_invitee_uri: invitee.uri,
            provider_state: { $in: ["active", "rescheduled"] },
          })
        );
        if (booking) {
          await sr.entities.Booking.update(booking.id, {
            provider_state: "canceled",
            cancel_reason: invitee.cancel_reason || "",
            canceled_at: invitee.canceled_at || new Date().toISOString(),
          });
          processed++;
        }
      }
    } catch (e) {
      errors++;
    }
  }

  // Update sync cursor
  await sr.entities.CalendarConnection.update(connection.id, {
    last_sync_at: new Date().toISOString(),
    last_sync_status: errors > 0 ? "partial" : "success",
    last_sync_cursor: lookbackEnd.toISOString(),
    last_sync_error: errors > 0 ? `${errors} errors during reconciliation` : "",
  });

  // Release outage hold only after catch-up and pending stops complete
  if (connection.outage_hold) {
    const releaseResult = await releaseOutageHold(sr, connection.id);
    if (!releaseResult?.released) {
      // Still pending stops — keep the hold
      return { processed, errors, hold_released: false, pending_stops: releaseResult?.pending_stops || 0 };
    }
  }

  return { processed, errors, lookback: { start: lookbackStart.toISOString(), end: lookbackEnd.toISOString() } };
}

// --- Fetch all scheduled events with pagination ---
async function fetchAllScheduledEvents(accessToken, userUri, minStart, maxStart, status) {
  const all = [];
  let url = `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&min_start_time=${encodeURIComponent(minStart)}&max_start_time=${encodeURIComponent(maxStart)}&status=${status}&per_page=${API_PAGE_SIZE}`;
  let pageCount = 0;
  while (url && pageCount < 20) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) break;
    const data = await res.json();
    all.push(...(data.collection || []));
    url = data.pagination?.next_page || null;
    pageCount++;
  }
  return all;
}

// --- Fetch invitees for a scheduled event ---
async function fetchEventInvitees(accessToken, eventUri) {
  const all = [];
  let url = `${eventUri}/invitees?per_page=${API_PAGE_SIZE}`;
  let pageCount = 0;
  while (url && pageCount < 10) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) break;
    const data = await res.json();
    all.push(...(data.collection || []));
    url = data.pagination?.next_page || null;
    pageCount++;
  }
  return all;
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

  if (contact) {
    await applyBookingStop(sr, workspaceId, contact.id, booking.id, "system:reconcile");
  }

  if (ctx && ctx.id) {
    await sr.entities.BookingContext.update(ctx.id, {
      consumed_at: new Date().toISOString(),
      consumed_booking_id: booking.id,
    });
  }
}