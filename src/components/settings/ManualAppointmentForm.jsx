import React, { useState } from "react";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function ManualAppointmentForm({ open, onClose, onSaved }) {
  const { current } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const start = new Date(values.get("start"));
      const end = new Date(values.get("end"));
      if (end <= start) throw new Error("End time must be after the start time.");
      await base44.functions.invoke("bookingAccess", {action: "manualBooking", workspace_id: current.id,
        invitee_email: values.get("email"), invitee_name: values.get("name"), event_title: values.get("title"),
        start_time_utc: start.toISOString(), end_time_utc: end.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone});
      onClose(); onSaved();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => !value && !busy && onClose()}><DialogContent>
    <DialogHeader><DialogTitle>Record appointment</DialogTitle></DialogHeader>
    <form onSubmit={save} className="space-y-3">
      <p className="text-sm text-muted-foreground">Enter the confirmed appointment details. Recording it also stops remaining follow-up for this contact.</p>
      <Label htmlFor="appointment-email">Contact email</Label><Input id="appointment-email" name="email" type="email" required />
      <Label htmlFor="appointment-name">Contact name</Label><Input id="appointment-name" name="name" />
      <Label htmlFor="appointment-title">Appointment title</Label><Input id="appointment-title" name="title" required />
      <Label htmlFor="appointment-start">Start (your local time)</Label><Input id="appointment-start" name="start" type="datetime-local" required />
      <Label htmlFor="appointment-end">End (your local time)</Label><Input id="appointment-end" name="end" type="datetime-local" required />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={busy} type="submit">{busy ? "Saving…" : "Record appointment"}</Button>
    </form>
  </DialogContent></Dialog>;
}