import React, { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import {
  Loader2, Calendar, Check, X, ExternalLink, AlertCircle, Link as LinkIcon,
} from "lucide-react";

export function BookingTab({ funnel, draft, onChanged }) {
  const { current, canAdmin } = useWorkspace();
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [eventTypes, setEventTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedEventTypeId, setSelectedEventTypeId] = useState(draft?.booking_event_type_id || "");
  const [ctaLabel, setCtaLabel] = useState(draft?.booking_cta_label || "Book a time");
  const [ctaCopy, setCtaCopy] = useState(draft?.booking_cta_copy || "");
  const [linkOnlyUrl, setLinkOnlyUrl] = useState(draft?.booking_config?.calendly_url || "");

  async function load() {
    if (!current) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke("calendlyAccess", { action: "getStatus", workspace_id: current.id });
      setConnectionStatus(res.data);
      if (res.data?.connected) {
        const etRes = await base44.functions.invoke("calendlyAccess", { action: "listEventTypes", workspace_id: current.id });
        setEventTypes(etRes.data?.event_types || []);
      }
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [current]);
  useEffect(() => {
    setSelectedEventTypeId(draft?.booking_event_type_id || "");
    setCtaLabel(draft?.booking_cta_label || "Book a time");
    setCtaCopy(draft?.booking_cta_copy || "");
    setLinkOnlyUrl(draft?.booking_config?.calendly_url || "");
  }, [draft]);

  const selectedEventType = eventTypes.find((et) => et.id === selectedEventTypeId);

  async function save() {
    setSaving(true);
    try {
      const update = {
        booking_cta_label: ctaLabel,
        booking_cta_copy: ctaCopy,
      };
      if (selectedEventTypeId) {
        update.booking_event_type_id = selectedEventTypeId;
        update.booking_config = {
          calendly_url: selectedEventType?.scheduling_url || "",
          event_type: selectedEventType?.display_name || "",
        };
      } else if (linkOnlyUrl) {
        update.booking_event_type_id = "";
        update.booking_config = { calendly_url: linkOnlyUrl, event_type: "" };
      }
      await base44.functions.invoke("funnelAccess", {
        action: "saveDraft",
        funnel_id: funnel.id,
        ...update,
      });
      toast({ title: "Booking settings saved" });
      onChanged();
    } catch (e) {
      toast({ title: "Save failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 text-slate-300 animate-spin" /></div>;

  const connected = connectionStatus?.connected;
  const publishedBooking = draft?.booking_config?.calendly_url;

  return (
    <div className="space-y-4">
      {/* Draft vs Published notice */}
      {funnel.state === "published" && publishedBooking && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs text-amber-700">
          <strong>Published:</strong> {publishedBooking}
          {selectedEventTypeId && selectedEventType?.scheduling_url !== publishedBooking && (
            <span className="ml-2 text-amber-600">(draft has a different event type — publish to update the live page)</span>
          )}
        </div>
      )}

      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold text-slate-800 mb-1">Booking event type</h3>
          <p className="text-xs text-slate-500 mb-4">
            Choose a connected Calendly event type for this funnel. Only individual, single-host appointments are supported in this phase.
          </p>

          {connected ? (
            eventTypes.length === 0 ? (
              <div className="text-sm text-slate-400 py-4 text-center">
                No event types synced yet. Go to Settings → Integrations → Calendly and click "Sync event types".
              </div>
            ) : (
              <div className="space-y-2">
                {eventTypes.filter((et) => et.supported).map((et) => (
                  <label
                    key={et.id}
                    className={`flex items-center justify-between border rounded-lg p-3 cursor-pointer transition-colors ${selectedEventTypeId === et.id ? "border-indigo-400 bg-indigo-50/50" : "border-slate-200 hover:border-slate-300"}`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        checked={selectedEventTypeId === et.id}
                        onChange={() => setSelectedEventTypeId(et.id)}
                        className="text-indigo-600"
                      />
                      <div>
                        <div className="text-sm font-medium text-slate-800">{et.display_name}</div>
                        <div className="text-xs text-slate-400">{et.duration_minutes} minutes</div>
                      </div>
                    </div>
                    <a href={et.scheduling_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </label>
                ))}
                {eventTypes.filter((et) => !et.supported).length > 0 && (
                  <p className="text-xs text-slate-400 mt-2">
                    {eventTypes.filter((et) => !et.supported).length} group/round-robin event type(s) hidden (not supported in this phase).
                  </p>
                )}
              </div>
            )
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-amber-600">
                <AlertCircle className="w-4 h-4" />
                Calendly is not connected. You can use a link-only URL below, but bookings won't be tracked automatically.
              </div>
              <div>
                <Label className="text-xs text-slate-500">Scheduling URL (link-only)</Label>
                <div className="flex items-center gap-2 mt-1.5">
                  <LinkIcon className="w-4 h-4 text-slate-400 shrink-0" />
                  <Input
                    value={linkOnlyUrl}
                    onChange={(e) => { setLinkOnlyUrl(e.target.value); setSelectedEventTypeId(""); }}
                    placeholder="https://calendly.com/your-link"
                    className="flex-1"
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">A pasted URL is link-only until its account/event type is verified via OAuth.</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* CTA customization */}
      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold text-slate-800 mb-4">Booking CTA</h3>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-slate-500">Button label</Label>
              <Input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} placeholder="Book a time" className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs text-slate-500">Short copy (optional)</Label>
              <Textarea value={ctaCopy} onChange={(e) => setCtaCopy(e.target.value)} placeholder="Pick a time that works for you and we'll talk through your situation." rows={2} className="mt-1.5" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      {selectedEventType && (
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold text-slate-800 mb-3">Preview</h3>
            <div className="rounded-lg border border-slate-200 p-6 text-center max-w-sm mx-auto">
              <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center mb-3 bg-indigo-50">
                <Calendar className="w-6 h-6 text-indigo-600" />
              </div>
              <h4 className="font-semibold text-slate-900">{ctaLabel || "Book a time"}</h4>
              {ctaCopy && <p className="text-sm text-slate-500 mt-1">{ctaCopy}</p>}
              <a href={selectedEventType.scheduling_url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block px-6 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium">
                {ctaLabel || "Book a time"}
              </a>
              <p className="text-xs text-slate-400 mt-2">{selectedEventType.display_name} · {selectedEventType.duration_minutes} min</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Save */}
      {canAdmin && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
            {saving ? "Saving..." : "Save booking settings"}
          </Button>
        </div>
      )}
    </div>
  );
}

export default BookingTab;