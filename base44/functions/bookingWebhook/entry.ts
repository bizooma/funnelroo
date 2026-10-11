import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import {
  requireMembership,
  firstRecord,
  asArray,
  ok,
  err,
  HttpError,
} from "../../shared/auth.ts";
import {
  parseCalendlyEvent,
  enrichWithEventDetails,
  verifyCalendlySignature,
  isCalendlyWebhookSigningConfigured,
  getConnectionAccessToken,
  resolveBookingContext,
  determineAttribution,
  matchContact,
  ensureContactFromBooking,
  normalizeEmail,
  upsertBooking,
  linkRescheduleChain,
  applyBookingStop,
  resolveFunnelLead,
  deterministicEventId,
} from "../../shared/booking.ts";
import { secrets } from "base44:runtime";

// Public Calendly webhook endpoint. Verifies the signature against the raw
// body, validates the signed timestamp, enforces payload limits, resolves
// the workspace from the registered connection, and processes the event
// durably with bounded retries.
//
// Subscribes to: invitee.created, invitee.canceled.
// A callback path, query parameter, tracking token, email, or unsigned
// workspace_id is insufficient to identify the workspace — we resolve from
// the registered connection's provider account/event ownership.

const MAX_PAYLOAD_BYTES = 512 * 1024; // 512KB limit

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;

    // Read raw body for signature verification
    const rawBody = await req.text();
    if (rawBody.length > MAX_PAYLOAD_BYTES) {
      return err(413, "Payload too large");
    }

    // Verify signature
    const signingKey = secrets.get("CALENDLY_WEBHOOK_SIGNING_KEY");
    if (!isCalendlyWebhookSigningConfigured()) {
      // Without signing key, we cannot verify — reject
      return err(503, "Webhook signing key not configured");
    }

    // Calendly sends the timestamp inside the signature header as "t=<ts>,v1=<sig>"
    // No separate Calendly-Webhook-Timestamp header exists in the webhook contract.
    const signatureHeader = req.headers.get("Calendly-Webhook-Signature") || "";

    const valid = await verifyCalendlySignature(rawBody, signatureHeader, signingKey);
    if (!valid) {
      return err(401, "Invalid webhook signature");
    }

    const payload = JSON.parse(rawBody);
    const parsed = parseCalendlyEvent(payload);

    // Reject malformed supported events — do not silently skip
    if (!parsed.event_type) {
      return err(400, "Missing webhook event type");
    }
    if (!["invitee.created", "invitee.canceled"].includes(parsed.event_type)) {
      return ok({ skipped: "unsupported_event_type", event_type: parsed.event_type });
    }
    if (!parsed.invitee_uri || !parsed.event_uri) {
      return err(400, "Missing required invitee or event URI in payload");
    }

    // Resolve workspace from the connection by provider user/event ownership.
    // We match the event_type_uri or provider_user_uri to a registered connection.
    // The webhook payload includes the organization and user; we find the
    // connection that owns this event type.
    const connections = asArray(
      await sr.entities.CalendarConnection.filter({
        provider: "calendly",
        status: { $in: ["connected", "reconnect_required"] },
      })
    );

    // Find the connection whose event types include this event_type_uri
    let connection = null;
    let eventType = null;
    for (const c of connections) {
      const ets = asArray(
        await sr.entities.BookingEventType.filter({
          workspace_id: c.workspace_id,
          connection_id: c.id,
          provider_event_type_uri: parsed.event_type_uri,
        })
      );
      if (ets.length) {
        connection = c;
        eventType = ets[0];
        break;
      }
    }

    if (!connection) {
      // Could be a historical event type that's no longer active — check all
      for (const c of connections) {
        const ets = asArray(
          await sr.entities.BookingEventType.filter({
            workspace_id: c.workspace_id,
            connection_id: c.id,
            provider_event_type_uri: parsed.event_type_uri,
            active: { $ne: false },
          })
        );
        if (ets.length) {
          connection = c;
          eventType = ets[0];
          break;
        }
      }
    }

    if (!connection) {
      // Event from a disconnected/obsolete connection generation — ignore
      return ok({ skipped: "no_matching_connection" });
    }

    const workspaceId = connection.workspace_id;

    // Enrich with start_time, end_time, event_title via authenticated lookup
    // of the scheduled event resource (not present in the invitee webhook payload)
    if (parsed.event_type === "invitee.created" && !parsed.start_time) {
      const accessToken = await getConnectionAccessToken(sr, connection.id);
      if (accessToken) {
        Object.assign(parsed, await enrichWithEventDetails(parsed, accessToken));
      }
    }

    // Generate deterministic event ID for deduplication.
    // Key includes event_type + event_uuid + invitee_uuid so that:
    // - Duplicate deliveries of the same event are caught
    // - A cancel for an already-created appointment is NOT skipped
    // - Different invitees of the same group event are NOT skipped
    const providerEventId = deterministicEventId(
      connection.id, parsed.event_type, parsed.invitee_uri, parsed.event_uri
    );

    // Persist deduplicated event before acknowledging
    let bookingEvent = firstRecord(
      await sr.entities.BookingEvent.filter({ workspace_id: workspaceId, provider_event_id: providerEventId })
    );
    if (bookingEvent) {
      return ok({ skipped: "duplicate", booking_id: bookingEvent.booking_id });
    }

    bookingEvent = await sr.entities.BookingEvent.create({
      workspace_id: workspaceId,
      connection_id: connection.id,
      provider_event_id: providerEventId,
      event_type: parsed.event_type,
      provider_event_uri: parsed.event_uri,
      provider_invitee_uri: parsed.invitee_uri,
      payload: { raw: payload },
      signature_valid: true,
      processing_status: "processing",
      attempts: 1,
    });

    try {
      if (parsed.event_type === "invitee.created") {
        await processInviteeCreated(sr, connection, eventType, parsed, workspaceId);
      } else if (parsed.event_type === "invitee.canceled") {
        await processInviteeCanceled(sr, connection, parsed, workspaceId);
      }

      await sr.entities.BookingEvent.update(bookingEvent.id, {
        processing_status: "processed",
        processed_at: new Date().toISOString(),
      });

      return ok({ processed: true, event_type: parsed.event_type });
    } catch (e) {
      await sr.entities.BookingEvent.update(bookingEvent.id, {
        processing_status: "failed",
        last_error: String(e?.message || e),
        attempts: (bookingEvent.attempts || 1) + 1,
      });
      // Still return 200 so Calendly doesn't retry indefinitely
      return ok({ processed: false, error: String(e?.message || e) });
    }
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}

// --- Process invitee.created ---
async function processInviteeCreated(sr, connection, eventType, parsed, workspaceId) {
  // Extract tracking token from payload
  const tracking = parsed.tracking || {};
  const token = String(tracking.utm_content || "").trim();

  // Resolve booking context
  const ctxResult = await resolveBookingContext(
    sr, workspaceId, token, connection.id, eventType?.id
  );

  const attribution = determineAttribution(ctxResult);
  const ctx = ctxResult?.valid ? ctxResult.context : null;

  // Match contact by normalized invitee email
  let contact = await matchContact(sr, workspaceId, parsed.invitee_email);

  // If no contact and we have reliable funnel context, create one
  if (!contact && parsed.invitee_email) {
    contact = await ensureContactFromBooking(sr, workspaceId, parsed.invitee_email, parsed.invitee_name);
  }

  // If context was bound to a contact but the booking email differs, do NOT
  // attach the booking to the original contact. Match the actual invitee.
  if (ctx?.contact_id && contact && ctx.contact_id !== contact.id) {
    // Contact-bound link booked with a different email — leave uncertain attribution
    attribution.status = "unattributed";
  }

  // Resolve FunnelLead if reliable funnel context
  let leadId = "";
  if (attribution.status === "reliable" && contact) {
    const lead = await resolveFunnelLead(sr, workspaceId, contact.id, attribution.funnelId, "booking");
    leadId = lead?.id || "";
  }

  // Handle reschedule linking
  if (parsed.old_invitee && parsed.new_invitee) {
    await linkRescheduleChain(sr, workspaceId, parsed.old_invitee, parsed.new_invitee);
  }

  // Upsert the booking
  const booking = await upsertBooking(sr, workspaceId, {
    connection_id: connection.id,
    event_type_id: eventType?.id || "",
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
    event_title: parsed.event_title,
    start_time_utc: parsed.start_time,
    end_time_utc: parsed.end_time,
    cancel_url: parsed.cancel_url,
    reschedule_url: parsed.reschedule_url,
    provenance: "provider_confirmed",
    attribution_status: attribution.status,
    attribution_label: attribution.label,
    created_at_provider: parsed.created_at,
  });

  // Apply nurture stop for qualifying bookings
  if (contact && eventType) {
    await applyBookingStop(sr, workspaceId, contact.id, booking.id, "system:booking_webhook");
  }

  // Consume the booking context
  if (ctx && ctx.id) {
    await sr.entities.BookingContext.update(ctx.id, {
      consumed_at: new Date().toISOString(),
      consumed_booking_id: booking.id,
    });
  }
}

// --- Process invitee.canceled ---
async function processInviteeCanceled(sr, connection, parsed, workspaceId) {
  // Find the booking by connection + invitee URI
  const booking = firstRecord(
    await sr.entities.Booking.filter({
      workspace_id: workspaceId,
      connection_id: connection.id,
      provider_invitee_uri: parsed.invitee_uri,
    })
  );

  if (!booking) return; // No booking to cancel

  // Update only this occurrence
  await sr.entities.Booking.update(booking.id, {
    provider_state: "canceled",
    cancel_reason: parsed.cancel_reason,
    canceled_by: parsed.canceled_by,
    canceled_at: parsed.canceled_at || new Date().toISOString(),
  });

  // Do NOT restart nurture — cancellation never automatically restarts promotion
}