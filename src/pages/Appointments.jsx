import React, { useEffect, useState, useCallback } from "react";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import {
  Calendar, Clock, CheckCircle2, XCircle, HelpCircle, Search,
  Loader2, ChevronLeft, ChevronRight, ExternalLink, User,
} from "lucide-react";
import { Link } from "react-router-dom";

const VIEWS = [
  { id: "upcoming", label: "Upcoming" },
  { id: "needs_outcome", label: "Needs outcome" },
  { id: "attended", label: "Attended" },
  { id: "no_show", label: "No-show" },
  { id: "canceled", label: "Canceled" },
  { id: "all", label: "All" },
];

export function Appointments() {
  const { current } = useWorkspace();
  const [view, setView] = useState("upcoming");
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState("");

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke("bookingAccess", {
        action: "list",
        workspace_id: current.id,
        view,
        limit: 50,
      });
      setAppointments(res.data?.appointments || []);
      setHasMore(res.data?.has_more || false);
      setCursor(res.data?.next_cursor || "");
    } catch (e) {
      toast({ title: "Could not load appointments", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [current, view]);

  useEffect(() => { load(); }, [load]);

  const filtered = search
    ? appointments.filter((a) =>
        (a.invitee_name || "").toLowerCase().includes(search.toLowerCase()) ||
        (a.invitee_email || "").toLowerCase().includes(search.toLowerCase()) ||
        (a.event_title || "").toLowerCase().includes(search.toLowerCase())
      )
    : appointments;

  return (
    <AppShell>
      <div className="p-8 max-w-6xl">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Appointments</h1>
        <p className="text-sm text-slate-500 mb-6">Track confirmed appointments, attendance, and sales outcomes.</p>

        {/* View tabs */}
        <div className="flex items-center gap-1 border-b border-slate-200 mb-4">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${view === v.id ? "text-indigo-600" : "text-slate-500 hover:text-slate-700"}`}
            >
              {v.label}
              {view === v.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or event title..."
            className="pl-9 max-w-sm"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-slate-300 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="p-8 text-center">
            <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No appointments in this view yet.</p>
            <p className="text-xs text-slate-400 mt-1">Connect Calendly in Settings to start tracking confirmed bookings automatically.</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {filtered.map((a) => <AppointmentRow key={a.id} appointment={a} />)}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function AppointmentRow({ appointment: a }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState(null);

  async function loadDetail() {
    if (detail) { setExpanded(!expanded); return; }
    try {
      const res = await base44.functions.invoke("bookingAccess", { action: "get", booking_id: a.id });
      setDetail(res.data);
      setExpanded(true);
    } catch (e) {
      toast({ title: "Could not load detail", variant: "destructive" });
    }
  }

  const stateColors = {
    active: "bg-emerald-100 text-emerald-700",
    canceled: "bg-rose-100 text-rose-700",
    rescheduled: "bg-amber-100 text-amber-700",
  };
  const attendanceColors = {
    unknown: "bg-slate-100 text-slate-500",
    attended: "bg-emerald-100 text-emerald-700",
    no_show: "bg-rose-100 text-rose-700",
  };

  const startDate = a.start_time_utc ? new Date(a.start_time_utc) : null;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-800 truncate">{a.event_title || "Appointment"}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full capitalize ${stateColors[a.provider_state] || stateColors.active}`}>{a.provider_state}</span>
                {a.provenance === "manual" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Manual</span>}
                {a.provenance === "legacy_manual" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Legacy</span>}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-slate-500 truncate">{a.contact_name || a.invitee_name || "—"}</span>
                {a.funnel_name && <><span className="text-slate-300">·</span><span className="text-xs text-slate-400 truncate">{a.funnel_name}</span></>}
              </div>
              {startDate && (
                <div className="flex items-center gap-1 mt-0.5">
                  <Clock className="w-3 h-3 text-slate-400" />
                  <span className="text-xs text-slate-400">
                    {startDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} at{" "}
                    {startDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    {a.invitee_timezone ? ` ${a.invitee_timezone}` : ""}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full capitalize ${attendanceColors[a.attendance_outcome] || attendanceColors.unknown}`}>
              {a.attendance_outcome?.replace("_", " ") || "unknown"}
            </span>
            <Button size="sm" variant="ghost" onClick={loadDetail}>
              {expanded ? "Hide" : "Details"}
            </Button>
          </div>
        </div>

        {expanded && detail && (
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Contact</p>
                {detail.contact ? (
                  <Link to={`/contacts/${detail.contact.id}`} className="text-indigo-600 hover:underline flex items-center gap-1">
                    <User className="w-3 h-3" /> {detail.contact.display_name || detail.contact.email}
                  </Link>
                ) : <span className="text-slate-400">—</span>}
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Funnel</p>
                {detail.funnel ? (
                  <Link to={`/funnels/${detail.funnel.id}`} className="text-indigo-600 hover:underline">{detail.funnel.name}</Link>
                ) : <span className="text-slate-400">Unattributed</span>}
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Event type</p>
                <span className="text-slate-600">{detail.event_type?.display_name || "—"}</span>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Attribution</p>
                <span className="text-slate-600 capitalize">{detail.booking.attribution_status?.replace("_", " ") || "—"}</span>
              </div>
            </div>

            {detail.reschedule_history?.length > 1 && (
              <div>
                <p className="text-xs text-slate-400 mb-1">Reschedule history</p>
                <div className="space-y-1">
                  {detail.reschedule_history.map((r, i) => (
                    <div key={r.id} className="text-xs text-slate-500 flex items-center gap-2">
                      <span className="text-slate-400">#{i + 1}</span>
                      {new Date(r.start_time_utc).toLocaleString()}
                      <span className={`text-[10px] px-1 py-0.5 rounded-full capitalize ${r.provider_state === "canceled" ? "bg-rose-50 text-rose-500" : "bg-emerald-50 text-emerald-600"}`}>
                        {r.provider_state}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <AttendanceControls booking={detail.booking} onChanged={() => loadDetail()} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AttendanceControls({ booking, onChanged }) {
  const [setting, setSetting] = useState(false);

  async function setAttendance(outcome) {
    setSetting(true);
    try {
      await base44.functions.invoke("bookingAccess", {
        action: "setAttendance",
        booking_id: booking.id,
        outcome,
      });
      toast({ title: "Attendance updated" });
      onChanged();
    } catch (e) {
      toast({ title: "Failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setSetting(false);
    }
  }

  const isPast = booking.start_time_utc && new Date(booking.start_time_utc) < new Date();
  const isCanceled = booking.provider_state === "canceled";

  if (!isPast || isCanceled) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400">Mark:</span>
      <Button size="sm" variant={booking.attendance_outcome === "attended" ? "default" : "outline"} disabled={setting} onClick={() => setAttendance("attended")}>
        {setting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Attended
      </Button>
      <Button size="sm" variant={booking.attendance_outcome === "no_show" ? "default" : "outline"} disabled={setting} onClick={() => setAttendance("no_show")}>
        <XCircle className="w-3.5 h-3.5" /> No-show
      </Button>
      {booking.attendance_outcome !== "unknown" && (
        <Button size="sm" variant="ghost" disabled={setting} onClick={() => setAttendance("unknown")}>
          <HelpCircle className="w-3.5 h-3.5" /> Clear
        </Button>
      )}
    </div>
  );
}

export default Appointments;