import { runAppointmentCheck } from "./appointmentChecks.ts";

// Entirely in-memory fixtures: no customer records, provider calls, or sending.
export async function runBookingFixtures(ingest) {
  const tables = {};
  const match = (row, query) => Object.entries(query).every(([key, value]) => {
    if (value && typeof value === "object") {
      if (value.$in) return value.$in.includes(row[key]);
      if (value.$gte) return row[key] >= value.$gte;
      if (value.$ne !== undefined) return row[key] !== value.$ne;
    }
    return value === null ? row[key] == null : row[key] === value;
  });
  const sr = {entities: new Proxy({}, {get: (_, name) => {
    tables[name] ||= [];
    return {
      filter: async (query, options) => {
        const rows = tables[name].filter(row => match(row, query));
        if (!options) return rows;
        const start = Number(options.cursor || 0), items = rows.slice(start, start + options.limit);
        return {items, has_more: start + items.length < rows.length, next_cursor: String(start + items.length)};
      },
      create: async data => {const row = {...data, id: crypto.randomUUID()}; tables[name].push(row); return row;},
      update: async (id, data) => {const row = tables[name].find(r => r.id === id); if (!row) throw new Error("Missing fixture row"); Object.assign(row, data); return row;},
      updateMany: async (query, updates) => {for (const row of tables[name].filter(r => match(r, query))) Object.assign(row, updates.$set);},
    };
  }})};
  const root = "https://api.calendly.com", email = "booking-fixture@example.invalid";
  const connection = await sr.entities.CalendarConnection.create({workspace_id: "fixture", provider_user_uri: `${root}/users/fixture`});
  const contact = await sr.entities.Contact.create({workspace_id: "fixture", email, email_normalized: email, display_name: "Fixture"});
  await sr.entities.NurtureEnrollment.create({workspace_id: "fixture", contact_id: contact.id, state: "active"});
  await sr.entities.BookingContext.create({workspace_id: "fixture", token: "fixture-context", connection_id: connection.id, contact_id: contact.id, funnel_id: "fixture-funnel"});
  const event = {uri: `${root}/scheduled_events/old`, name: "Beyond 30 days", start_time: new Date(Date.now() + 120 * 86400000).toISOString(), end_time: new Date(Date.now() + 120 * 86400000 + 3600000).toISOString(), status: "active"};
  const invitee = {uri: `${event.uri}/invitees/old`, event: event.uri, email, name: "Fixture", status: "active", tracking: {utm_content: "fixture-context"}};
  let discovery = true, replacement = null, paginated = false, fail = false;
  const request = async url => {
    const u = new URL(url);
    if (u.searchParams.has("max_start_time")) throw new Error("Future discovery is incorrectly capped");
    if (fail) return Response.json({}, {status: 503});
    if (u.pathname === "/scheduled_events") {
      const active = u.searchParams.get("status") === "active";
      if (paginated && !u.searchParams.has("page_token")) return Response.json({collection: [], pagination: {next_page: `${url}&page_token=next`}});
      return Response.json({collection: discovery && active ? [replacement?.event || event] : [], pagination: {}});
    }
    const candidates = [[event, invitee], ...(replacement ? [[replacement.event, replacement.invitee]] : [])];
    for (const [e, i] of candidates) {
      if (u.pathname === new URL(e.uri).pathname) return Response.json({resource: e});
      if (u.pathname === new URL(i.uri).pathname) return Response.json({resource: i});
      if (u.pathname === `${new URL(e.uri).pathname}/invitees`) return Response.json({collection: [i], pagination: {}});
    }
    return Response.json({}, {status: 404});
  };
  const check = async () => {
    for (let n = 0; n < 20; n++) {
      const result = await runAppointmentCheck(sr, connection, "fixture-only", (i, e) => ingest(sr, connection, i, e), request);
      if (result.error || result.complete) return result;
    }
    throw new Error("Fixture did not finish bounded continuation");
  };
  const assert = (condition, message) => {if (!condition) throw new Error(message);};
  paginated = true;
  assert((await check()).complete, "Paginated discovery incomplete");
  assert(tables.Booking.length === 1 && tables.Booking[0].nurture_stopped, "Future booking not recorded/stopped");
  assert(tables.Booking[0].funnel_id === "fixture-funnel", "Contact attribution lost");
  assert(tables.NurtureEnrollment[0].state === "stopped", "Follow-up not stopped");
  await check(); assert(tables.Booking.length === 1, "Repeat check duplicated appointment");
  discovery = false; invitee.status = "canceled"; event.status = "canceled";
  event.start_time = new Date(Date.now() - 60 * 86400000).toISOString();
  await check(); assert(tables.Booking[0].provider_state === "canceled", "Cancellation outside discovery boundary missed");
  tables.Booking[0].provider_state = "active";
  const next = {...event, uri: `${root}/scheduled_events/new`, status: "active", start_time: new Date(Date.now() + 800 * 86400000).toISOString(), end_time: new Date(Date.now() + 800 * 86400000 + 3600000).toISOString()};
  replacement = {event: next, invitee: {...invitee, status: "active", event: next.uri, uri: `${next.uri}/invitees/new`, old_invitee: invitee.uri}};
  invitee.new_invitee = replacement.invitee.uri;
  await check();
  assert(tables.Booking.length === 2 && tables.Booking.filter(b => b.provider_state === "active").length === 1, "Replacement recording incorrect");
  assert(new Set(tables.Booking.map(b => b.reschedule_group_id || b.id)).size === 1, "Reschedule counted as duplicate logical appointment");
  fail = true;
  const success = connection.last_booking_check_success_at;
  assert(!(await check()).complete && connection.last_booking_check_success_at === success, "Failure overwrote last successful check");
  return {isolated: true, sending: "not invoked", checks: ["120-day future booking", "pagination", "contact attribution", "follow-up stop", "idempotent repeat", "cancellation outside window", "800-day reschedule reference", "one logical appointment", "failed check keeps last success"], live_sync: "pending", report_screen: "pending"};
}