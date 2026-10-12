// A bounded, resumable scan. The provider's optional max_start_time is omitted:
// all future appointments are eligible, regardless of scheduling horizon.
const ROOT = "https://api.calendly.com";
export async function runAppointmentCheck(sr, connection, accessToken, ingest, request = fetch) {
  const started = Date.now();
  let remaining = 24;
  const state = structuredClone(connection.booking_check_state || {});
  if (!state.phase) Object.assign(state, {phase: "active", since: new Date(Date.now() - 30 * 86400000).toISOString(), events: [], replacements: []});
  const get = async (url) => {
    const target = new URL(url);
    if (target.origin !== ROOT) throw new Error("Unexpected appointment response address");
    if (remaining <= 0 || Date.now() - started > 90000) throw new Error("CHECK_BUDGET");
    remaining--;
    const response = await request(target.toString(), {headers: {Authorization: `Bearer ${accessToken}`}, signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error(`Appointment check failed (${response.status})`);
    return response.json();
  };
  const persist = (status, error = "") => sr.entities.CalendarConnection.update(connection.id, {
    booking_check_state: state, booking_check_status: status,
    last_booking_check_attempt_at: new Date().toISOString(), booking_check_error: error,
  });
  try {
    while (remaining > 2 && Date.now() - started < 80000) {
      // Replacement lookup uses the exact invitee reference, not a date window.
      if (state.replacements?.length) {
        const uri = state.replacements[0];
        const {resource: invitee} = await get(uri);
        const {resource: event} = await get(invitee.event);
        await ingest(invitee, event);
        if (invitee.new_invitee && !state.replacements.includes(invitee.new_invitee)) state.replacements.push(invitee.new_invitee);
        state.replacements.shift();
        await persist("partial");
        continue;
      }
      if (state.events?.length) {
        const event = state.events[0];
        const data = await get(state.inviteeUrl || `${event.uri}/invitees?count=50`);
        for (const invitee of data.collection || []) {
          await ingest(invitee, event);
          if (invitee.new_invitee && !state.replacements.includes(invitee.new_invitee)) state.replacements.push(invitee.new_invitee);
        }
        state.inviteeUrl = data.pagination?.next_page || "";
        if (!state.inviteeUrl) state.events.shift();
        await persist("partial");
        continue;
      }
      if (state.phase === "tracked") {
        if (state.tracked?.length) {
          const booking = state.tracked[0];
          const {resource: event} = await get(booking.event);
          const {resource: invitee} = await get(booking.invitee);
          await ingest(invitee, event);
          if (invitee.new_invitee) state.replacements.push(invitee.new_invitee);
          state.tracked.shift();
          await persist("partial");
          continue;
        }
        if (state.trackedDone) {
          const completedAt = new Date().toISOString();
          await sr.entities.CalendarConnection.update(connection.id, {
            booking_check_state: {}, booking_check_status: "success", booking_check_error: "",
            last_booking_check_success_at: completedAt, last_booking_check_attempt_at: completedAt,
          });
          return {complete: true};
        }
        const page = await sr.entities.Booking.filter({
          workspace_id: connection.workspace_id, connection_id: connection.id,
          provenance: "provider_confirmed", provider_state: {$in: ["active", "rescheduled"]},
        }, {sort: "created_date", limit: 50, ...(state.trackedCursor ? {cursor: state.trackedCursor} : {})});
        state.tracked = page.items.map(b => ({event: b.provider_event_uri, invitee: b.provider_invitee_uri}));
        state.trackedCursor = page.next_cursor || "";
        state.trackedDone = !page.has_more;
        await persist("partial");
        continue;
      }
      if (state.listDone) {
        state.phase = state.phase === "active" ? "canceled" : "tracked";
        state.listDone = false;
        state.listUrl = "";
        await persist("partial");
        continue;
      }
      const url = new URL(`${ROOT}/scheduled_events`);
      url.search = new URLSearchParams({user: connection.provider_user_uri, min_start_time: state.since, status: state.phase, count: "50", sort: "start_time:asc"}).toString();
      const page = await get(state.listUrl || url.toString());
      state.events = (page.collection || []).map(e => ({uri: e.uri, name: e.name, start_time: e.start_time, end_time: e.end_time, event_type: e.event_type, status: e.status}));
      state.listUrl = page.pagination?.next_page || "";
      state.listDone = !state.listUrl;
      await persist("partial");
    }
    await persist("partial");
    return {complete: false, pending: true};
  } catch (error) {
    if (error.message === "CHECK_BUDGET") {
      await persist("partial");
      return {complete: false, pending: true};
    }
    await persist("failed", error.message);
    return {complete: false, error: error.message};
  }
}