import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { AlertCircle } from "lucide-react";

// Free-plan limitation explanation shown ONLY when the cause is established:
// webhook_health === "missing" AND plan_supports_webhooks === false.
// Adapts the follow-up and appointment-check wording based on actual state.
export function CalendlyLimitationNotice({
  followUpPaused,
  backgroundChecksWorking,
  lastCheck,
  affectedFunnels,
}) {
  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <h3 className="font-semibold text-slate-800">
            Your calendar is connected, but instant booking updates are unavailable
          </h3>
        </div>

        <p className="text-sm text-slate-600">
          People can still use your booking link to schedule appointments with you.
          However, Calendly's free plan does not immediately tell FunnelRoo when
          someone books, cancels, or changes an appointment.
        </p>

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
            Appointments and reports
          </p>
          <p className="text-sm text-slate-600">
            New bookings and appointment changes may not appear in FunnelRoo right
            away. Your booking totals can be incomplete until those appointments are
            recorded.
            {backgroundChecksWorking && lastCheck && (
              <>
                {" "}
                Appointments update after the next successful appointment check
                (last check: {lastCheck}).
              </>
            )}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
            Follow-up emails
          </p>
          {followUpPaused ? (
            <p className="text-sm text-slate-600">
              Your booking follow-up emails are paused because we can't confirm who
              has already booked. People can still use your booking link.
            </p>
          ) : (
            <p className="text-sm text-slate-600">
              A lead may continue receiving emails inviting them to book until
              FunnelRoo records their appointment or you stop their follow-up.
            </p>
          )}
          {followUpPaused && affectedFunnels && affectedFunnels.length > 0 && (
            <div className="mt-2 rounded-md bg-white/60 border border-amber-200 p-2.5">
              <p className="text-xs font-medium text-slate-500 mb-1">Affected sequences:</p>
              <ul className="text-xs text-slate-600 space-y-0.5">
                {affectedFunnels.map((f, i) => (
                  <li key={i}>
                    {f.funnel_name ? `${f.funnel_name} — ` : ""}{f.sequence_name || "Unnamed sequence"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
            What to do for now
          </p>
          <p className="text-sm text-slate-600">
            When someone books, open their contact in FunnelRoo and select{" "}
            <Link to="/contacts" className="text-indigo-600 hover:underline font-medium">
              Mark booked
            </Link>{" "}
            to stop their remaining follow-up emails. Also record the appointment in
            FunnelRoo to keep your appointment history and reports current.
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
            To enable instant booking updates
          </p>
          <p className="text-sm text-slate-600">
            Upgrade to a Calendly plan that supports them, then check your connection
            again.
          </p>
        </div>

        <p className="text-xs text-slate-400 italic">
          This does not require a different FunnelRoo plan.
        </p>
      </CardContent>
    </Card>
  );
}

export default CalendlyLimitationNotice;