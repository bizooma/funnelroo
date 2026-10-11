import React, { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, TrendingUp, CalendarCheck, UserPlus, Trophy, AlertCircle } from "lucide-react";

export default function ConversionReport() {
  const { current } = useWorkspace();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await base44.functions.invoke("bookingAccess", {
          action: "report",
          workspace_id: current.id,
        });
        if (!cancelled) setReport(res.data?.metrics || {});
      } catch (e) {
        if (!cancelled) setError("Couldn't load conversion data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [current]);

  if (loading) {
    return (
      <Card><CardContent className="p-6 flex items-center justify-center text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading conversion data…
      </CardContent></Card>
    );
  }

  if (error) {
    return (
      <Card><CardContent className="p-6 flex items-center text-rose-500 text-sm">
        <AlertCircle className="w-4 h-4 mr-2" /> {error}
      </CardContent></Card>
    );
  }

  const m = report || {};
  const fmtPct = (v) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);
  const fmtNum = (v) => (v === null || v === undefined ? "0" : String(v));

  return (
    <div className="space-y-4">
      {/* Conversion funnel */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-indigo-500" />
            <h3 className="font-semibold text-slate-800">Lead-to-booking conversion</h3>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FunnelStep
              icon={UserPlus}
              label="Captured leads"
              value={fmtNum(m.captured_leads)}
              color="text-slate-700"
              bg="bg-slate-50"
            />
            <FunnelStep
              icon={CalendarCheck}
              label="Booked (attributed)"
              value={fmtNum(m.captured_leads_with_booking)}
              color="text-indigo-700"
              bg="bg-indigo-50"
            />
            <FunnelStep
              icon={TrendingUp}
              label="Conversion rate"
              value={fmtPct(m.captured_lead_to_booking_rate)}
              color="text-emerald-700"
              bg="bg-emerald-50"
            />
          </div>
        </CardContent>
      </Card>

      {/* Appointments breakdown */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold text-slate-800 mb-3">Appointments</h3>
            <div className="space-y-2 text-sm">
              <Row label="Gross booked" value={fmtNum(m.gross_booked_appointments)} />
              <Row label="Provider-confirmed" value={fmtNum(m.provider_confirmed_appointments)} />
              <Row label="Manual" value={fmtNum(m.manual_appointments)} />
              <Row label="Direct-booking contacts" value={fmtNum(m.direct_booking_contacts)} />
              <Row label="Upcoming" value={fmtNum(m.upcoming)} accent="text-indigo-600" />
              <Row label="Canceled" value={fmtNum(m.canceled)} accent="text-rose-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold text-slate-800 mb-3">Attendance & outcomes</h3>
            <div className="space-y-2 text-sm">
              <Row label="Attended" value={fmtNum(m.attended)} accent="text-emerald-600" />
              <Row label="No-show" value={fmtNum(m.no_show)} accent="text-rose-500" />
              <Row label="Needs outcome" value={fmtNum(m.attendance_unknown)} accent="text-amber-600" />
              <Row label="Show rate" value={fmtPct(m.show_rate)} />
              <Row label="Attendance coverage" value={fmtPct(m.attendance_recording_coverage)} />
              <Row label="Attribution coverage" value={fmtPct(m.attribution_coverage)} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Won / Lost */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="w-4 h-4 text-amber-500" />
            <h3 className="font-semibold text-slate-800">Sales outcomes</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-3 bg-emerald-50 rounded-lg p-3">
              <Trophy className="w-5 h-5 text-emerald-600" />
              <div>
                <div className="text-xl font-bold text-emerald-700">{fmtNum(m.won_leads)}</div>
                <div className="text-xs text-emerald-600">Won</div>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-rose-50 rounded-lg p-3">
              <AlertCircle className="w-5 h-5 text-rose-500" />
              <div>
                <div className="text-xl font-bold text-rose-600">{fmtNum(m.lost_leads)}</div>
                <div className="text-xs text-rose-500">Lost</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FunnelStep({ icon: Icon, label, value, color, bg }) {
  return (
    <div className={`rounded-lg p-3 ${bg}`}>
      <Icon className={`w-4 h-4 ${color} mb-1.5`} />
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

function Row({ label, value, accent }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={`font-medium ${accent || "text-slate-700"}`}>{value}</span>
    </div>
  );
}