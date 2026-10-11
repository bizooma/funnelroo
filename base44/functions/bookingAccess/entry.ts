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
  applyBookingStop,
  resolveFunnelLead,
  normalizeEmail,
  hasQualifyingBooking,
} from "../../shared/booking.ts";

// Workspace-authorized booking management: list appointments, manual booking,
// attendance, sales stage, link attribution, and conversion reporting.
//
// Owners/admins manage connections, publication, and sync settings.
// Members may view authorized records and enter permitted lead/attendance outcomes.

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    // ---- list: appointments with filters and pagination ----
    if (action === "list") {
      await requireMembership(base44, body.workspace_id);
      const query = { workspace_id: body.workspace_id };

      // Filters
      if (body.view === "upcoming") {
        query.start_time_utc = { $gte: new Date().toISOString() };
        query.provider_state = { $in: ["active", "rescheduled"] };
      } else if (body.view === "needs_outcome") {
        query.start_time_utc = { $lt: new Date().toISOString() };
        query.provider_state = { $in: ["active", "rescheduled"] };
        query.attendance_outcome = "unknown";
      } else if (body.view === "attended") {
        query.attendance_outcome = "attended";
      } else if (body.view === "no_show") {
        query.attendance_outcome = "no_show";
      } else if (body.view === "canceled") {
        query.provider_state = "canceled";
      }

      if (body.funnel_id) query.funnel_id = body.funnel_id;
      if (body.event_type_id) query.event_type_id = body.event_type_id;
      if (body.status) query.provider_state = body.status;

      const limit = Math.min(Number(body.limit || 50), 100);
      const sort = body.sort || "-start_time_utc";

      const page = await sr.entities.Booking.filter(query, { sort, limit });
      const items = page.items || [];

      // Enrich with contact and funnel names
      const enriched = [];
      for (const b of items) {
        let contactName = "";
        let contactEmail = "";
        if (b.contact_id) {
          const c = firstRecord(await sr.entities.Contact.filter({ id: b.contact_id }));
          contactName = c?.display_name || c?.first_name || "";
          contactEmail = c?.email || "";
        }
        let funnelName = "";
        if (b.funnel_id) {
          const f = firstRecord(await sr.entities.Funnel.filter({ id: b.funnel_id }));
          funnelName = f?.name || "";
        }
        let eventTypeName = "";
        if (b.event_type_id) {
          const et = firstRecord(await sr.entities.BookingEventType.filter({ id: b.event_type_id }));
          eventTypeName = et?.display_name || "";
        }
        enriched.push({
          ...b,
          contact_name: contactName,
          contact_email: contactEmail,
          funnel_name: funnelName,
          event_type_name: eventTypeName,
        });
      }

      return ok({
        appointments: enriched,
        has_more: page.has_more || false,
        next_cursor: page.next_cursor || "",
      });
    }

    // ---- get: appointment detail ----
    if (action === "get") {
      const booking = firstRecord(await sr.entities.Booking.filter({ id: body.booking_id }));
      if (!booking) return err(404, "Appointment not found");
      await requireMembership(base44, booking.workspace_id);

      // Enrich
      let contact = null;
      if (booking.contact_id) {
        contact = firstRecord(await sr.entities.Contact.filter({ id: booking.contact_id }));
      }
      let funnel = null;
      if (booking.funnel_id) {
        funnel = firstRecord(await sr.entities.Funnel.filter({ id: booking.funnel_id }));
      }
      let eventType = null;
      if (booking.event_type_id) {
        eventType = firstRecord(await sr.entities.BookingEventType.filter({ id: booking.event_type_id }));
      }

      // Reschedule history
      let rescheduleHistory = [];
      if (booking.reschedule_group_id) {
        rescheduleHistory = asArray(
          await sr.entities.Booking.filter({
            workspace_id: booking.workspace_id,
            reschedule_group_id: booking.reschedule_group_id,
          }, { sort: "start_time_utc" })
        );
      }

      return ok({
        booking,
        contact: contact ? { id: contact.id, display_name: contact.display_name, email: contact.email } : null,
        funnel: funnel ? { id: funnel.id, name: funnel.name } : null,
        event_type: eventType ? { id: eventType.id, display_name: eventType.display_name } : null,
        reschedule_history: rescheduleHistory,
      });
    }

    // ---- manualBooking: record a manual booking ----
    if (action === "manualBooking") {
      const { user } = await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);

      // Resolve or create contact
      let contact = null;
      if (body.contact_id) {
        contact = firstRecord(await sr.entities.Contact.filter({ id: body.contact_id, workspace_id: body.workspace_id }));
      } else if (body.invitee_email) {
        const emailNorm = normalizeEmail(body.invitee_email);
        contact = firstRecord(
          await sr.entities.Contact.filter({ workspace_id: body.workspace_id, email_normalized: emailNorm })
        );
        if (!contact) {
          const nameParts = String(body.invitee_name || "").trim().split(/\s+/);
          contact = await sr.entities.Contact.create({
            workspace_id: body.workspace_id,
            email: body.invitee_email,
            email_normalized: emailNorm,
            first_name: nameParts[0] || "",
            last_name: nameParts.slice(1).join(" ") || "",
            display_name: body.invitee_name || body.invitee_email,
            source: "manual_booking",
            first_known_source: "manual_booking",
            tags: [],
          });
        }
      }

      if (!contact) return err(400, "Contact or email is required");

      // Create manual booking
      const booking = await sr.entities.Booking.create({
        workspace_id: body.workspace_id,
        contact_id: contact.id,
        funnel_id: body.funnel_id || "",
        funnel_lead_id: body.funnel_lead_id || "",
        invitee_email: contact.email,
        invitee_email_normalized: contact.email_normalized,
        invitee_name: contact.display_name || contact.first_name || "",
        invitee_timezone: body.timezone || "",
        event_title: body.event_title || "Manual booking",
        start_time_utc: body.start_time_utc,
        end_time_utc: body.end_time_utc || "",
        original_start_time_utc: body.start_time_utc,
        provider_state: "active",
        attendance_outcome: "unknown",
        provenance: "manual",
        attribution_status: body.funnel_id ? "manual_link" : "unattributed",
        attribution_label: "manual",
        notes: body.notes || "",
        confirmed_at: new Date().toISOString(),
      });

      // If funnel context provided, resolve lead
      if (body.funnel_id) {
        await resolveFunnelLead(sr, body.workspace_id, contact.id, body.funnel_id, "manual");
      }

      // Apply nurture stop
      await applyBookingStop(sr, body.workspace_id, contact.id, booking.id, `staff:${user.id}`);

      return ok({ booking });
    }

    // ---- quickBooked: retain a quick manual booked indication ----
    if (action === "quickBooked") {
      const { user } = await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const contact = firstRecord(await sr.entities.Contact.filter({ id: body.contact_id, workspace_id: body.workspace_id }));
      if (!contact) return err(404, "Contact not found");

      // Mark contact booking_outcome as legacy manual indication
      await sr.entities.Contact.update(contact.id, {
        booking_outcome: "booked",
        booking_outcome_at: new Date().toISOString(),
        booking_outcome_by: user.id,
      });

      // Stop nurture
      const { stopAllEnrollments } = await import("../../shared/nurture.ts");
      const stopped = await stopAllEnrollments(sr, body.workspace_id, contact.id, "staff:quick_booked", user.id);

      return ok({ contact, stopped_enrollments: stopped, legacy: true });
    }

    // ---- setAttendance: mark attended or no-show ----
    if (action === "setAttendance") {
      const { user } = await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const booking = firstRecord(await sr.entities.Booking.filter({ id: body.booking_id, workspace_id: body.workspace_id }));
      if (!booking) return err(404, "Appointment not found");

      const outcome = body.outcome; // "attended" or "no_show"
      if (!["attended", "no_show", "unknown"].includes(outcome)) {
        return err(400, "Invalid attendance outcome");
      }

      // Only for past, noncanceled current occurrence
      if (booking.provider_state === "canceled") {
        return err(400, "Cannot set attendance for a canceled appointment");
      }
      if (booking.start_time_utc && new Date(booking.start_time_utc) > new Date()) {
        return err(400, "Cannot set attendance for a future appointment");
      }

      const updated = await sr.entities.Booking.update(booking.id, {
        attendance_outcome: outcome,
        attendance_set_by: user.id,
        attendance_set_at: new Date().toISOString(),
      });

      return ok({ booking: updated });
    }

    // ---- setSalesStage: set lead's sales stage to Won or Lost ----
    if (action === "setSalesStage") {
      const { user } = await requireMembership(base44, body.workspace_id, ["owner", "admin", "member"]);
      const lead = firstRecord(await sr.entities.FunnelLead.filter({ id: body.lead_id, workspace_id: body.workspace_id }));
      if (!lead) return err(404, "Lead not found");

      const stage = body.stage; // "won" or "lost"
      if (!["won", "lost", "new", "nurturing", "booked"].includes(stage)) {
        return err(400, "Invalid sales stage");
      }

      // New provider events must not overwrite a closed Won/Lost stage
      if (["won", "lost"].includes(lead.sales_stage) && !["won", "lost"].includes(stage)) {
        return err(400, `Cannot change a closed ${lead.sales_stage.toUpperCase()} stage back to ${stage}`);
      }

      const updated = await sr.entities.FunnelLead.update(lead.id, {
        sales_stage: stage,
        stage_changed_by: user.id,
        stage_changed_at: new Date().toISOString(),
        stage_change_reason: body.reason || "",
      });

      return ok({ lead: updated });
    }

    // ---- linkAttribution: manually link a booking to a funnel ----
    if (action === "linkAttribution") {
      const { user } = await requireMembership(base44, body.workspace_id, ["owner", "admin"]);
      const booking = firstRecord(await sr.entities.Booking.filter({ id: body.booking_id, workspace_id: body.workspace_id }));
      if (!booking) return err(404, "Appointment not found");

      const funnel = firstRecord(await sr.entities.Funnel.filter({ id: body.funnel_id, workspace_id: body.workspace_id }));
      if (!funnel) return err(404, "Funnel not found");

      // Resolve lead
      const lead = await resolveFunnelLead(sr, body.workspace_id, booking.contact_id, body.funnel_id, "manual");

      const updated = await sr.entities.Booking.update(booking.id, {
        funnel_id: body.funnel_id,
        funnel_lead_id: lead?.id || "",
        attribution_status: "manual_link",
        attribution_label: `manual:${user.id}`,
      });

      return ok({ booking: updated, lead });
    }

    // ---- report: conversion reporting ----
    if (action === "report") {
      await requireMembership(base44, body.workspace_id);
      const range = body.date_range || {}; // { start, end } ISO strings
      const workspaceId = body.workspace_id;

      // Captured-lead cohort: distinct FunnelLead records first created through
      // accepted capture in the selected date range
      const leadQuery = { workspace_id: workspaceId, origin: { $ne: "booking" } };
      if (range.start) leadQuery.first_seen_at = { $gte: range.start };
      if (range.end) {
        leadQuery.first_seen_at = leadQuery.first_seen_at
          ? { $gte: range.start, $lte: range.end }
          : { $lte: range.end };
      }
      const cohortLeads = asArray(await sr.entities.FunnelLead.filter(leadQuery, { limit: 1000 }));

      // Distinct captured leads with a reliably attributed confirmed booking
      const cohortLeadIds = cohortLeads.map((l) => l.id);
      let attributedLeadIds = new Set();
      if (cohortLeadIds.length) {
        const bookings = asArray(
          await sr.entities.Booking.filter({
            workspace_id: workspaceId,
            funnel_lead_id: { $in: cohortLeadIds },
            attribution_status: "reliable",
            provenance: { $in: ["provider_confirmed", "manual"] },
          }, { limit: 1000 })
        );
        attributedLeadIds = new Set(bookings.map((b) => b.funnel_lead_id).filter(Boolean));
      }

      // Gross booked appointments: distinct logical appointment groups first
      // confirmed in the selected booking-created range
      const bookingQuery = { workspace_id: workspaceId };
      if (range.start || range.end) {
        bookingQuery.confirmed_at = {};
        if (range.start) bookingQuery.confirmed_at.$gte = range.start;
        if (range.end) bookingQuery.confirmed_at.$lte = range.end;
      }
      const allBookings = asArray(await sr.entities.Booking.filter(bookingQuery, { limit: 1000 }));

      // Gross booked = distinct reschedule_group_id (or id if no group)
      const groupIds = new Set();
      for (const b of allBookings) {
        groupIds.add(b.reschedule_group_id || b.id);
      }
      const grossBooked = groupIds.size;

      // Manual appointments (separately)
      const manualBookings = allBookings.filter((b) => b.provenance === "manual");

      // Provider-confirmed logical appointments
      const providerConfirmed = allBookings.filter((b) => b.provenance === "provider_confirmed");

      // Upcoming, canceled, attended, no-show, unknown
      const now = new Date();
      const upcoming = allBookings.filter((b) => b.provider_state !== "canceled" && b.start_time_utc && new Date(b.start_time_utc) > now);
      const canceled = allBookings.filter((b) => b.provider_state === "canceled");
      const attended = allBookings.filter((b) => b.attendance_outcome === "attended");
      const noShow = allBookings.filter((b) => b.attendance_outcome === "no_show");
      const attendanceUnknown = allBookings.filter((b) =>
        b.attendance_outcome === "unknown" &&
        b.provider_state !== "canceled" &&
        b.start_time_utc && new Date(b.start_time_utc) < now
      );

      // Show rate: attended / (attended + no_show) for appointments whose
      // scheduled start falls in the chosen period
      const periodStart = range.start ? new Date(range.start) : new Date(0);
      const periodEnd = range.end ? new Date(range.end) : new Date();
      const periodBookings = allBookings.filter((b) => {
        if (!b.start_time_utc) return false;
        const st = new Date(b.start_time_utc);
        return st >= periodStart && st <= periodEnd && b.provider_state !== "canceled";
      });
      const periodAttended = periodBookings.filter((b) => b.attendance_outcome === "attended");
      const periodNoShow = periodBookings.filter((b) => b.attendance_outcome === "no_show");
      const periodEligiblePast = periodBookings.filter((b) => new Date(b.start_time_utc) < now);
      const periodAssessed = periodEligiblePast.filter((b) => b.attendance_outcome !== "unknown");

      // Attribution coverage
      const confirmedWithFunnel = providerConfirmed.filter((b) => b.attribution_status === "reliable");

      // Won/Lost lead counts
      const wonLeads = asArray(await sr.entities.FunnelLead.filter({ workspace_id: workspaceId, sales_stage: "won" }, { limit: 1000 }));
      const lostLeads = asArray(await sr.entities.FunnelLead.filter({ workspace_id: workspaceId, sales_stage: "lost" }, { limit: 1000 }));

      // Direct-booking contacts created only after booking
      const directBookingContacts = asArray(
        await sr.entities.Contact.filter({ workspace_id: workspaceId, first_known_source: "direct_booking" }, { limit: 1000 })
      );

      // Compute rates
      const capturedLeadToBookingRate = cohortLeads.length > 0
        ? attributedLeadIds.size / cohortLeads.length
        : null;

      const showRate = (periodAttended.length + periodNoShow.length) > 0
        ? periodAttended.length / (periodAttended.length + periodNoShow.length)
        : null;

      const attendanceCoverage = periodEligiblePast.length > 0
        ? periodAssessed.length / periodEligiblePast.length
        : null;

      const attributionCoverage = providerConfirmed.length > 0
        ? confirmedWithFunnel.length / providerConfirmed.length
        : null;

      return ok({
        metrics: {
          captured_leads: cohortLeads.length,
          captured_leads_with_booking: attributedLeadIds.size,
          captured_lead_to_booking_rate: capturedLeadToBookingRate,
          gross_booked_appointments: grossBooked,
          provider_confirmed_appointments: providerConfirmed.length,
          manual_appointments: manualBookings.length,
          direct_booking_contacts: directBookingContacts.length,
          upcoming: upcoming.length,
          canceled: canceled.length,
          attended: attended.length,
          no_show: noShow.length,
          attendance_unknown: attendanceUnknown.length,
          show_rate: showRate,
          attendance_recording_coverage: attendanceCoverage,
          attribution_coverage: attributionCoverage,
          won_leads: wonLeads.length,
          lost_leads: lostLeads.length,
        },
        reporting_cutoff: new Date().toISOString(),
        date_range: range,
      });
    }

    // ---- perFunnelReport: per-funnel conversion report ----
    if (action === "perFunnelReport") {
      await requireMembership(base44, body.workspace_id);
      const funnelId = body.funnel_id;
      const range = body.date_range || {};

      const leads = asArray(
        await sr.entities.FunnelLead.filter({ workspace_id: body.workspace_id, funnel_id: funnelId }, { limit: 1000 })
      );
      const bookings = asArray(
        await sr.entities.Booking.filter({ workspace_id: body.workspace_id, funnel_id: funnelId }, { limit: 1000 })
      );

      const providerConfirmed = bookings.filter((b) => b.provenance === "provider_confirmed");
      const manual = bookings.filter((b) => b.provenance === "manual");
      const canceled = bookings.filter((b) => b.provider_state === "canceled");
      const attended = bookings.filter((b) => b.attendance_outcome === "attended");
      const noShow = bookings.filter((b) => b.attendance_outcome === "no_show");

      const wonLeads = leads.filter((l) => l.sales_stage === "won");
      const lostLeads = leads.filter((l) => l.sales_stage === "lost");

      return ok({
        funnel_id: funnelId,
        metrics: {
          captured_leads: leads.length,
          provider_confirmed_bookings: providerConfirmed.length,
          manual_bookings: manual.length,
          canceled_bookings: canceled.length,
          attended: attended.length,
          no_show: noShow.length,
          won_leads: wonLeads.length,
          lost_leads: lostLeads.length,
        },
      });
    }

    // ---- getContactBookings: bookings for a contact (for ContactDetail) ----
    if (action === "getContactBookings") {
      const contact = firstRecord(await sr.entities.Contact.filter({ id: body.contact_id }));
      if (!contact) return err(404, "Contact not found");
      await requireMembership(base44, contact.workspace_id);

      const bookings = asArray(
        await sr.entities.Booking.filter(
          { workspace_id: contact.workspace_id, contact_id: contact.id },
          { sort: "-start_time_utc", limit: 50 }
        )
      );

      // Enrich with funnel and event type names
      const enriched = [];
      for (const b of bookings) {
        let funnelName = "";
        if (b.funnel_id) {
          const f = firstRecord(await sr.entities.Funnel.filter({ id: b.funnel_id }));
          funnelName = f?.name || "";
        }
        let eventTypeName = "";
        if (b.event_type_id) {
          const et = firstRecord(await sr.entities.BookingEventType.filter({ id: b.event_type_id }));
          eventTypeName = et?.display_name || "";
        }
        enriched.push({ ...b, funnel_name: funnelName, event_type_name: eventTypeName });
      }

      return ok({ bookings: enriched });
    }

    return err(400, `Unknown action: ${action}`);
  } catch (e) {
    if (e instanceof HttpError) return err(e.status, e.message);
    return err(500, e.message);
  }
}