import React from "react";
import { Card, CardContent } from "@/components/ui/card";

export default function CalendlyLimitationNotice({ followUpPaused, followUpState, backgroundChecksWorking, lastCheck, affectedFunnels, restriction, affectedCount }) {
  const free = restriction === "free_plan";
  const restricted = free || restriction === "plan_restriction";
  const followUp = followUpPaused
    ? "Your booking follow-up emails are paused because we can't confirm who has already booked. People can still use your booking link."
    : followUpState === "running"
      ? "Booking follow-up is running. A lead may continue receiving booking invitations until their appointment is recorded or you stop their follow-up."
      : followUpState === "paused" ? "Your booking follow-up is paused by your sending settings."
      : followUpState === "not_configured" ? "Booking follow-up is not configured." : "Booking follow-up status could not be confirmed.";
  return <Card><CardContent className="p-5 space-y-3">
    <h3 className="font-semibold text-foreground">Your calendar is connected, but instant booking updates are unavailable</h3>
    <p className="text-sm text-muted-foreground">People can still use your booking link. Booking updates are limited.</p>
    <p className="text-sm text-muted-foreground">{followUp}</p>
    <p className="text-sm text-foreground">When someone books, open their contact and select Mark booked to stop remaining follow-up, then record their appointment details separately.{restricted ? " To enable instant updates, review Calendly plans, then select Check connection after upgrading." : " Select Check connection to confirm what is available."}</p>
    <details className="text-sm">
      <summary className="cursor-pointer font-medium text-primary">What this means for my account</summary>
      <div className="mt-3 space-y-3 text-muted-foreground">
        <p>{free ? "Calendly's free plan does not immediately tell FunnelRoo when someone books, cancels, or changes an appointment." : restricted ? "Calendly confirmed that your current plan does not support instant booking updates." : "The cause has not been confirmed. This may be a permission issue or a temporary setup problem; it is not evidence that you need to upgrade."}</p>
        <p><strong>Appointments and reports:</strong> New bookings and appointment changes may not appear right away. Booking totals can be incomplete until appointments are recorded.</p>
        <p>{backgroundChecksWorking && lastCheck ? `A full appointment check last succeeded on ${lastCheck}. Later changes still need a successful check; live booking synchronization remains unverified.` : "No successful full appointment check has been confirmed yet. Refreshing appointment types does not check bookings."}</p>
        <p><strong>Follow-up emails:</strong> {followUp}</p>
        {affectedFunnels?.length > 0 && <div><strong>Affected sequences:</strong><ul className="list-disc pl-5">{affectedFunnels.map((f, i) => <li key={i}>{f.funnel_name ? `${f.funnel_name}: ` : ""}{f.sequence_name}</li>)}</ul>{affectedCount > affectedFunnels.length && <p>Showing {affectedFunnels.length} of {affectedCount} affected sequences.</p>}</div>}
        <p><strong>What to do for now:</strong> Mark booked stops contact follow-up; it does not create appointment details. Record the appointment separately to keep history and reports current.</p>
        {restricted && <p>To enable instant booking updates, upgrade to a Calendly plan that supports them, then check your connection again. This does not require a different FunnelRoo plan.</p>}
      </div>
    </details>
  </CardContent></Card>;
}