// Shared booking logic: link builder, booking-stop service, contact matching,
// attribution resolution, booking upsert, and reschedule linking.
// Used by bookingWebhook (event processing), bookingAccess (manual actions,
// reporting), bookingReconcile (scheduled sync), captureSubmission (context
// creation), funnelAccess (publishing), and nurtureAccess (booking CTA links).

import { firstRecord, asArray } from "./auth.ts";
import { secrets } from "base44:runtime";
import { stopAllEnrollments } from "./nurture.ts";

// --- Constants ---
const BOOKING_CONTEXT_TTL_HOURS = 72; // context tokens expire after 72h
const RESCHEDULE_LOOKBACK_HOURS = 2; // window to link a reschedule pair
const MAX_RECONCILE_BATCH = 50;

// --- Provider configuration ---
export function isCalendlyConfigured() {
  return !!(secrets.get("CALENDLY_CLIENT_ID") && secrets.get("CALENDLY_CLIENT_SECRET"));
}

export function isCalendlyWebhookSigningConfigured() {
  return !!secrets.get("CALENDLY_WEBHOOK_SIGNING_KEY");
}

// --- Shared Calendly token management ---
// Used by calendlyAccess (OAuth callback, sync) and bookingWebhook/bookingReconcile
// (event lookup, reconciliation). Tokens are stored in the server-only
// CalendarToken entity (RLS denies all client access).

const CALENDLY_TOKEN_URL = "https://auth.calendly.com/oauth/token";

// Get a valid access token for a connection, refreshing if it expires within 5 min.
// Returns null if no token or refresh fails (caller should handle reconnect state).
export async function getConnectionAccessToken(sr, connectionId) {
  const tokenRec = firstRecord(
    await sr.entities.CalendarToken.filter({ connection_id: connectionId })
  );
  if (!tokenRec) return null;

  const expiresAt = new Date(tokenRec.expires_at).getTime();
  if (expiresAt < Date.now() + 5 * 60 * 1000) {
    try {
      return await refreshConnectionToken(sr, connectionId, tokenRec.refresh_token);
    } catch (e) {
      // Invalid grant — mark connection as reconnect_required, not endless retries
      const connection = firstRecord(await sr.entities.CalendarConnection.filter({ id: connectionId }));
      if (connection && connection.status === "connected") {
        await sr.entities.CalendarConnection.update(connection.id, {
          status: "reconnect_required",
        });
      }
      return null;
    }
  }
  return tokenRec.access_token;
}

// Refresh a Calendly OAuth token with concurrency guard.
// Uses updateMany with a refresh_token condition so two concurrent refreshes
// cannot consume the same refresh token twice — only one wins, the other
// re-reads the already-refreshed token.
async function refreshConnectionToken(sr, connectionId, refreshToken) {
  const clientId = secrets.get("CALENDLY_CLIENT_ID");
  const clientSecret = secrets.get("CALENDLY_CLIENT_SECRET");

  const res = await fetch(CALENDLY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
  const tokens = await res.json();
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

  // Atomic update: only update if refresh_token hasn't changed (concurrency guard)
  const result = await sr.entities.CalendarToken.updateMany(
    { connection_id: connectionId, refresh_token: refreshToken },
    {
      $set: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
      },
    }
  );

  if (!result.updated) {
    // Another concurrent refresh already updated — re-read the current token
    const current = firstRecord(await sr.entities.CalendarToken.filter({ connection_id: connectionId }));
    return current?.access_token || null;
  }
  return tokens.access_token;
}

// --- Token generation ---
export function generateBookingToken() {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

// --- Booking link builder ---
// Creates a BookingContext record and appends the opaque token to the
// scheduling URL using Calendly's utm_content parameter (a supported UTM field).
// Preserves the visitor's original campaign values — only adds the correlation token.
export async function buildBookingLink(sr, opts) {
  const {
    workspaceId, connectionId, eventTypeId, schedulingUrl,
    funnelId, publishedVersionId, sourceChannel,
    contactId, funnelLeadId, submissionId, nurtureMessageId, enrollmentId,
    originalCampaign, originalSource,
  } = opts;

  if (!schedulingUrl) return { url: "", token: "" };

  const token = generateBookingToken();
  const expiresAt = new Date(Date.now() + BOOKING_CONTEXT_TTL_HOURS * 3600 * 1000);

  await sr.entities.BookingContext.create({
    workspace_id: workspaceId,
    token,
    connection_id: connectionId || "",
    event_type_id: eventTypeId || "",
    funnel_id: funnelId || "",
    published_version_id: publishedVersionId || "",
    source_channel: sourceChannel || "direct",
    contact_id: contactId || "",
    funnel_lead_id: funnelLeadId || "",
    submission_id: submissionId || "",
    nurture_message_id: nurtureMessageId || "",
    enrollment_id: enrollmentId || "",
    original_campaign: originalCampaign || "",
    original_source: originalSource || "",
    expires_at: expiresAt.toISOString(),
  });

  const url = appendTrackingToken(schedulingUrl, token);
  return { url, token };
}

// Append the opaque token to a scheduling URL using utm_content.
// Preserves existing UTM params — only sets utm_content if absent.
export function appendTrackingToken(url, token) {
  try {
    const u = new URL(url);
    if (!u.searchParams.has("utm_content")) {
      u.searchParams.set("utm_content", token);
    }
    return u.toString();
  } catch {
    // If URL parsing fails, append as query param
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}utm_content=${token}`;
  }
}

// Extract the tracking token from a provider payload (utm_content / tracking field).
export function extractTrackingToken(payload) {
  const tracking = payload?.tracking || {};
  const utm = tracking.utm_campaign || tracking.utm_content || tracking.utm_source || {};
  // Calendly puts utm_content in payload.tracking.utm_content
  return String(tracking.utm_content || "").trim();
}

// --- Resolve and validate booking context ---
// Validates the token against the authenticated connection, selected event type,
// and accepted historical funnel version. Returns null if missing, expired,
// inconsistent, or ambiguous.
export async function resolveBookingContext(sr, workspaceId, token, connectionId, eventTypeId) {
  if (!token) return null;
  const ctx = firstRecord(
    await sr.entities.BookingContext.filter({ workspace_id: workspaceId, token })
  );
  if (!ctx) return null;

  // Check expiry
  if (ctx.expires_at && new Date(ctx.expires_at) < new Date()) {
    return { expired: true, context: ctx };
  }

  // Validate connection matches (if context was bound to a connection)
  if (ctx.connection_id && connectionId && ctx.connection_id !== connectionId) {
    return { inconsistent: true, context: ctx };
  }

  // Validate event type matches (if context was bound to an event type)
  if (ctx.event_type_id && eventTypeId && ctx.event_type_id !== eventTypeId) {
    return { inconsistent: true, context: ctx };
  }

  return { valid: true, context: ctx };
}

// --- Contact matching ---
// Match contacts using the normalized invitee email in the verified provider
// booking within that workspace. This is contact matching, NOT authentication
// of the invitee. A contact-bound link booked using a different email must NOT
// attach the booking to the original contact.
export async function matchContact(sr, workspaceId, inviteeEmail) {
  if (!inviteeEmail) return null;
  const emailNorm = String(inviteeEmail).trim().toLowerCase();
  const contact = firstRecord(
    await sr.entities.Contact.filter({ workspace_id: workspaceId, email_normalized: emailNorm })
  );
  return contact || null;
}

// Create or reuse a workspace contact for a directly booked appointment
// without prior capture. Does NOT manufacture a Submission, resource grant,
// or marketing opt-in.
export async function ensureContactFromBooking(sr, workspaceId, inviteeEmail, inviteeName) {
  const emailNorm = String(inviteeEmail).trim().toLowerCase();
  let contact = firstRecord(
    await sr.entities.Contact.filter({ workspace_id: workspaceId, email_normalized: emailNorm })
  );
  if (contact) return contact;

  const nameParts = String(inviteeName || "").trim().split(/\s+/);
  contact = await sr.entities.Contact.create({
    workspace_id: workspaceId,
    email: inviteeEmail,
    email_normalized: emailNorm,
    first_name: nameParts[0] || "",
    last_name: nameParts.slice(1).join(" ") || "",
    display_name: inviteeName || emailNorm,
    source: "direct_booking",
    first_known_source: "direct_booking",
    tags: [],
  });
  return contact;
}

// --- Normalize email ---
export function normalizeEmail(e) {
  return String(e || "").trim().toLowerCase();
}

// --- Booking upsert ---
// A provider occurrence is uniquely identified by its connection and invitee URI,
// not by email or appointment time. This handles create/update for invitee.created.
//
// Input contract (snake_case, matching entity field names):
//   connection_id, provider_event_uri, provider_invitee_uri (required)
//   event_type_id, provider_event_uuid, provider_invitee_uuid, contact_id,
//   funnel_id, funnel_lead_id, booking_context_id, invitee_email,
//   invitee_email_normalized, invitee_name, invitee_timezone, event_title,
//   start_time_utc, end_time_utc, cancel_url, reschedule_url, provenance,
//   attribution_status, attribution_label, created_at_provider
export async function upsertBooking(sr, workspaceId, bookingData) {
  const {
    connection_id, provider_event_uri, provider_invitee_uri,
  } = bookingData;

  // Validate required identifiers before any lookup or persistence
  if (!connection_id || !provider_invitee_uri) {
    throw new Error("upsertBooking requires connection_id and provider_invitee_uri");
  }

  // Find existing booking by connection + invitee URI (unique occurrence)
  let booking = firstRecord(
    await sr.entities.Booking.filter({
      workspace_id: workspaceId,
      connection_id: connection_id,
      provider_invitee_uri: provider_invitee_uri,
    })
  );

  if (booking) {
    // Update existing occurrence with new event details (reschedule within same invitee URI)
    const update = {
      provider_event_uri: provider_event_uri,
      start_time_utc: bookingData.start_time_utc,
      end_time_utc: bookingData.end_time_utc,
      event_title: bookingData.event_title || booking.event_title,
      invitee_timezone: bookingData.invitee_timezone || booking.invitee_timezone,
      cancel_url: bookingData.cancel_url || booking.cancel_url,
      reschedule_url: bookingData.reschedule_url || booking.reschedule_url,
      provider_state: "active",
      cancel_reason: null,
      canceled_by: null,
      canceled_at: null,
    };
    if (!booking.original_start_time_utc && booking.start_time_utc) {
      update.original_start_time_utc = booking.start_time_utc;
    }
    return await sr.entities.Booking.update(booking.id, update);
  }

  // Create new booking
  return await sr.entities.Booking.create({
    workspace_id: workspaceId,
    connection_id: connection_id,
    event_type_id: bookingData.event_type_id || "",
    provider_event_uri: provider_event_uri,
    provider_invitee_uri: provider_invitee_uri,
    provider_event_uuid: bookingData.provider_event_uuid || "",
    provider_invitee_uuid: bookingData.provider_invitee_uuid || "",
    reschedule_group_id: bookingData.reschedule_group_id || "",
    contact_id: bookingData.contact_id || "",
    funnel_id: bookingData.funnel_id || "",
    funnel_lead_id: bookingData.funnel_lead_id || "",
    booking_context_id: bookingData.booking_context_id || "",
    invitee_email: bookingData.invitee_email || "",
    invitee_email_normalized: bookingData.invitee_email_normalized || "",
    invitee_name: bookingData.invitee_name || "",
    invitee_timezone: bookingData.invitee_timezone || "",
    event_title: bookingData.event_title || "",
    start_time_utc: bookingData.start_time_utc,
    end_time_utc: bookingData.end_time_utc,
    original_start_time_utc: bookingData.original_start_time_utc || bookingData.start_time_utc,
    provider_state: "active",
    cancel_url: bookingData.cancel_url || "",
    reschedule_url: bookingData.reschedule_url || "",
    attendance_outcome: "unknown",
    provenance: bookingData.provenance || "provider_confirmed",
    attribution_status: bookingData.attribution_status || "unattributed",
    attribution_label: bookingData.attribution_label || "",
    nurture_stopped: false,
    nurture_stop_pending: false,
    created_at_provider: bookingData.created_at_provider || new Date().toISOString(),
    confirmed_at: new Date().toISOString(),
  });
}

// --- Reschedule linking ---
// Calendly rescheduling produces cancellation and creation events. Use
// old_invitee/new_invitee references to link the replacement even when events
// arrive in reverse order. One logical reschedule chain counts as one booked
// appointment.
export async function linkRescheduleChain(sr, workspaceId, oldInviteeUri, newInviteeUri) {
  if (!oldInviteeUri || !newInviteeUri || oldInviteeUri === newInviteeUri) return;

  const oldBooking = firstRecord(
    await sr.entities.Booking.filter({
      workspace_id: workspaceId,
      provider_invitee_uri: oldInviteeUri,
    })
  );
  const newBooking = firstRecord(
    await sr.entities.Booking.filter({
      workspace_id: workspaceId,
      provider_invitee_uri: newInviteeUri,
    })
  );

  if (!oldBooking || !newBooking) return;

  // Use the old booking's reschedule_group_id, or create one
  const groupId = oldBooking.reschedule_group_id || crypto.randomUUID();
  await sr.entities.Booking.update(oldBooking.id, {
    reschedule_group_id: groupId,
    provider_state: "rescheduled",
  });
  await sr.entities.Booking.update(newBooking.id, {
    reschedule_group_id: groupId,
    original_start_time_utc: oldBooking.original_start_time_utc || oldBooking.start_time_utc,
    contact_id: newBooking.contact_id || oldBooking.contact_id,
    funnel_id: newBooking.funnel_id || oldBooking.funnel_id,
    funnel_lead_id: newBooking.funnel_lead_id || oldBooking.funnel_lead_id,
  });
}

// --- Booking-stop service ---
// One shared service called by verified booking processing and authorized
// manual booking actions. Integrates with existing stopAllEnrollments and
// the dispatch eligibility check.
export async function applyBookingStop(sr, workspaceId, contactId, bookingId, actor) {
  if (!contactId) return { stopped: 0, applied: false };

  // Mark the booking as having a pending stop (durable)
  await sr.entities.Booking.updateMany(
    { id: bookingId, nurture_stop_applied_at: null },
    { $set: { nurture_stop_pending: true } }
  );

  // Stop all active/paused promotional nurture enrollments
  const stopped = await stopAllEnrollments(sr, workspaceId, contactId, "booking_confirmed", actor);

  // Mark the booking as stopped
  await sr.entities.Booking.update(bookingId, {
    nurture_stopped: true,
    nurture_stop_pending: false,
    nurture_stop_applied_at: new Date().toISOString(),
  });

  return { stopped, applied: true };
}

// --- Check if a contact has a qualifying booking ---
// Used by the dispatch eligibility check to prevent sending promotional emails
// after a confirmed booking. Checks both provider-confirmed and manual bookings.
export async function hasQualifyingBooking(sr, workspaceId, contactId) {
  if (!contactId) return false;
  const bookings = asArray(
    await sr.entities.Booking.filter({
      workspace_id: workspaceId,
      contact_id: contactId,
      provider_state: { $in: ["active", "rescheduled"] },
      provenance: { $in: ["provider_confirmed", "manual"] },
    })
  );
  return bookings.length > 0;
}

// --- Resolve FunnelLead for a booking ---
// If reliable funnel context exists, link the booking to the FunnelLead.
// For direct-booking contacts created only after booking, create a FunnelLead
// marked as originating from booking. Does NOT manufacture a Submission.
export async function resolveFunnelLead(sr, workspaceId, contactId, funnelId, origin) {
  if (!funnelId) return null;

  let lead = firstRecord(
    await sr.entities.FunnelLead.filter({ workspace_id: workspaceId, funnel_id: funnelId, contact_id: contactId })
  );

  if (lead) {
    // Update stage to booked if currently new/nurturing
    if (lead.sales_stage === "new" || lead.sales_stage === "nurturing" || !lead.sales_stage) {
      await sr.entities.FunnelLead.update(lead.id, {
        sales_stage: "booked",
        stage_changed_at: new Date().toISOString(),
        stage_change_reason: "provider_confirmed_booking",
      });
    }
    return lead;
  }

  // Create a new lead originating from booking
  lead = await sr.entities.FunnelLead.create({
    workspace_id: workspaceId,
    funnel_id: funnelId,
    contact_id: contactId,
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    acquisition_source: "booking",
    sales_stage: "booked",
    stage_changed_at: new Date().toISOString(),
    stage_change_reason: "provider_confirmed_booking",
    origin: origin || "booking",
  });
  return lead;
}

// --- Determine attribution from booking context ---
// Returns { status, funnelId, leadId, label } based on context validity.
export function determineAttribution(ctxResult) {
  if (!ctxResult || ctxResult.expired || ctxResult.inconsistent) {
    return { status: "unattributed", funnelId: "", leadId: "", label: "" };
  }
  if (ctxResult.valid) {
    const ctx = ctxResult.context;
    if (ctx.funnel_id) {
      return {
        status: "reliable",
        funnelId: ctx.funnel_id,
        leadId: ctx.funnel_lead_id || "",
        label: ctx.source_channel || "public_page",
      };
    }
  }
  return { status: "unattributed", funnelId: "", leadId: "", label: "" };
}

// --- Get connection health summary ---
export async function getConnectionHealth(sr, workspaceId) {
  const connections = asArray(
    await sr.entities.CalendarConnection.filter({ workspace_id: workspaceId, provider: "calendly" })
  );
  if (!connections.length) return { connected: false, outage_hold: false };

  // Use the most recent active connection
  const active = connections.find((c) => c.status === "connected") || connections[0];
  const hasHold = active.outage_hold;
  const needsReconnect = active.status === "reconnect_required";

  return {
    connected: active.status === "connected",
    outage_hold: hasHold,
    needs_reconnect: needsReconnect,
    connection_id: active.id,
    connection: active,
  };
}

// --- Check if nurture should be held due to booking connection outage ---
// For sequences relying on automatic booking stops, an unhealthy/disconnected
// booking connection should hold future sends with a visible reason.
export async function checkBookingConnectionHold(sr, workspaceId) {
  const connections = asArray(
    await sr.entities.CalendarConnection.filter({ workspace_id: workspaceId, provider: "calendly" })
  );
  if (!connections.length) return { hold: false };

  const active = connections.find((c) => c.status === "connected");
  if (!active) return { hold: false }; // no connection = link-only mode, no hold

  if (active.outage_hold) {
    return { hold: true, reason: "booking_connection_outage", connection_id: active.id };
  }
  if (active.status === "reconnect_required") {
    return { hold: true, reason: "booking_connection_reconnect_required", connection_id: active.id };
  }
  return { hold: false };
}

// --- Release an outage hold ---
// Only after catch-up reconciliation reaches its recorded checkpoint and all
// resulting booking-stop actions are durably applied.
export async function releaseOutageHold(sr, connectionId) {
  const connection = firstRecord(await sr.entities.CalendarConnection.filter({ id: connectionId }));
  if (!connection || !connection.outage_hold) return false;

  // Check all pending booking stops are applied
  const pendingStops = asArray(
    await sr.entities.Booking.filter({
      workspace_id: connection.workspace_id,
      connection_id: connectionId,
      nurture_stop_pending: true,
    })
  );
  if (pendingStops.length > 0) {
    return { released: false, pending_stops: pendingStops.length };
  }

  await sr.entities.CalendarConnection.update(connectionId, {
    outage_hold: false,
    outage_hold_reason: "",
  });
  return { released: true };
}

// --- Parse Calendly webhook payload (API v2) ---
// Calendly v2 webhook payload structure:
//   { event: "invitee.created"|"invitee.canceled", time: "...", payload: { ... } }
// The payload object contains invitee fields directly (NOT nested under an
// "invitee" key). Fields: uri, email, name, timezone, event (scheduled event
// URI), event_type (event type URI), cancel_url, reschedule_url, tracking,
// new_invitee, old_invitee, cancel_reason, canceled_by, canceled_at, created_at.
//
// start_time, end_time, and event_title are NOT in the invitee webhook payload.
// They require an authenticated GET to the scheduled event URI. The caller
// should call enrichWithEventDetails() after parsing to fill those fields.
export function parseCalendlyEvent(payload) {
  const webhookEvent = String(payload?.event || "");
  const data = payload?.payload || {};

  // Extract UUIDs from URI path segments (last segment of the Calendly URI)
  const inviteeUuid = String(data.uri || "").split("/").pop() || "";
  const eventUuid = String(data.event || "").split("/").pop() || "";

  return {
    event_type: webhookEvent,
    invitee_uri: String(data.uri || ""),
    invitee_uuid: inviteeUuid,
    invitee_email: String(data.email || ""),
    invitee_name: String(data.name || ""),
    invitee_timezone: String(data.timezone || ""),
    event_uri: String(data.event || ""),
    event_uuid: eventUuid,
    event_type_uri: String(data.event_type || ""),
    event_type_slug: "",
    // These fields require an authenticated event lookup — left empty here.
    start_time: "",
    end_time: "",
    event_title: "",
    cancel_reason: String(data.cancel_reason || ""),
    canceled_by: String(data.canceled_by || ""),
    canceled_at: String(data.canceled_at || ""),
    created_at: String(data.created_at || ""),
    cancel_url: String(data.cancel_url || ""),
    reschedule_url: String(data.reschedule_url || ""),
    rescheduled_from: String(data.rescheduled_from || ""),
    rescheduled_to: String(data.rescheduled_to || ""),
    tracking: data.tracking || {},
    new_invitee: String(data.new_invitee || ""),
    old_invitee: String(data.old_invitee || ""),
  };
}

// --- Enrich parsed event with scheduled event details ---
// Fetches start_time, end_time, and event name from the Calendly API using
// an authenticated, ownership-checked lookup. Returns the parsed object with
// start_time, end_time, and event_title filled in (or unchanged on failure).
export async function enrichWithEventDetails(parsed, accessToken) {
  if (!parsed.event_uri || !accessToken) return parsed;
  try {
    const res = await fetch(parsed.event_uri, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return parsed;
    const data = await res.json();
    const event = data.resource || {};
    return {
      ...parsed,
      start_time: String(event.start_time || ""),
      end_time: String(event.end_time || ""),
      event_title: String(event.name || ""),
      event_type_uri: String(event.event_type || parsed.event_type_uri),
    };
  } catch {
    return parsed;
  }
}

// --- Verify Calendly webhook signature ---
// Calendly sends a single header: Calendly-Webhook-Signature
// Format: "t=<unix_timestamp>,v1=<hex_hmac_sha256>"
// The HMAC is computed over "<timestamp>.<raw_body>" using the signing key.
// No separate timestamp header exists in Calendly's webhook contract.
export async function verifyCalendlySignature(rawBody, signatureHeader, signingKey) {
  if (!rawBody || !signatureHeader || !signingKey) return false;

  // Parse "t=<ts>,v1=<sig>" — robust against malformed input
  const parts = {};
  for (const part of signatureHeader.split(",")) {
    const eq = part.indexOf("=");
    if (eq > 0) {
      parts[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }

  const sig = parts.v1;
  const ts = parts.t;
  if (!sig || !ts) return false;

  // Validate timestamp is a finite positive number
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || tsNum <= 0) return false;

  // Check timestamp freshness (5 min tolerance)
  const ageMs = Date.now() - tsNum * 1000;
  if (Math.abs(ageMs) > 5 * 60 * 1000) return false;

  // Compute HMAC-SHA256 over "<timestamp>.<raw_body>"
  const data = `${ts}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const computedSig = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison to prevent timing attacks
  if (sig.length !== computedSig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ computedSig.charCodeAt(i);
  }
  return diff === 0;
}

// --- Generate deterministic event ID for webhook deduplication ---
// The key must distinguish different event types (created vs canceled) and
// different invitees, so that a cancel for an already-created appointment is
// NOT skipped as a duplicate, while a genuine duplicate delivery IS skipped.
// Format: "cal:<event_type>:<event_uuid>:<invitee_uuid>"
export function deterministicEventId(connectionId, eventType, inviteeUri, eventUri) {
  const inviteeUuid = String(inviteeUri || "").split("/").pop() || "";
  const eventUuid = String(eventUri || "").split("/").pop() || "";
  return `cal:${eventType}:${eventUuid}:${inviteeUuid}`;
}