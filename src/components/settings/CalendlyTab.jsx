import React, { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import {
  Loader2, Plug, Check, X, RefreshCw, AlertCircle, ExternalLink, Calendar,
} from "lucide-react";

export function CalendlyTab() {
  const { current, canAdmin } = useWorkspace();
  const [status, setStatus] = useState(null);
  const [eventTypes, setEventTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    if (!current) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke("calendlyAccess", { action: "getStatus", workspace_id: current.id });
      setStatus(res.data);
      if (res.data?.connected) {
        const etRes = await base44.functions.invoke("calendlyAccess", { action: "listEventTypes", workspace_id: current.id });
        setEventTypes(etRes.data?.event_types || []);
      }
    } catch (e) {
      toast({ title: "Could not load Calendly status", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [current]);

  async function connect() {
    if (!current) return;
    setConnecting(true);
    try {
      const res = await base44.functions.invoke("calendlyAccess", {
        action: "authorize",
        workspace_id: current.id,
        return_path: "/settings",
      });
      if (res.data?.auth_url) {
        window.location.href = res.data.auth_url;
      }
    } catch (e) {
      toast({ title: "Could not start Calendly connection", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setConnecting(false);
    }
  }

  async function syncEventTypes() {
    setSyncing(true);
    try {
      const res = await base44.functions.invoke("calendlyAccess", { action: "syncEventTypes", workspace_id: current.id });
      setEventTypes(res.data?.event_types || []);
      toast({ title: `Synced ${res.data?.synced || 0} event types` });
      load();
    } catch (e) {
      toast({ title: "Sync failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect Calendly? Automatic booking tracking will stop. Historical appointments are preserved.")) return;
    try {
      await base44.functions.invoke("calendlyAccess", { action: "disconnect", workspace_id: current.id });
      toast({ title: "Calendly disconnected" });
      load();
    } catch (e) {
      toast({ title: "Failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    }
  }

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 text-slate-300 animate-spin" /></div>;

  const connected = status?.connected;
  const configured = status?.configured;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-indigo-600" /> Calendly
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md">
                Connect your Calendly account to automatically track confirmed appointments, stop nurture sequences on booking, and report on conversion.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {connected ? (
                <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1">
                  <Check className="w-3 h-3" /> Connected
                </span>
              ) : status?.status === "link_only" ? (
                <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-500">Link-only</span>
              ) : (
                <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-400">Not connected</span>
              )}
            </div>
          </div>

          {/* Connection details */}
          {connected && (
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-400">Account</p>
                <p className="text-slate-700">{status.provider_user_name || "—"}</p>
                <p className="text-xs text-slate-400">{status.provider_user_email}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Webhook health</p>
                <p className="flex items-center gap-1">
                  {status.webhook_health === "healthy" ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-500" />}
                  <span className="text-slate-600 capitalize">{status.webhook_health || "unknown"}</span>
                </p>
                {!status.plan_supports_webhooks && <p className="text-xs text-amber-600 mt-0.5">Calendly paid plan required for webhooks</p>}
              </div>
              <div>
                <p className="text-xs text-slate-400">Last sync</p>
                <p className="text-slate-600 text-xs">{status.last_sync_at ? new Date(status.last_sync_at).toLocaleString() : "Never"}</p>
              </div>
              {status.outage_hold && (
                <div>
                  <p className="text-xs text-slate-400">Status</p>
                  <p className="text-amber-600 text-xs flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Outage hold active</p>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex items-center gap-2">
            {!configured && (
              <p className="text-xs text-amber-600 mr-2">Calendly credentials not configured. Add them in the app Secrets page to enable OAuth connection.</p>
            )}
            {!connected && configured && canAdmin && (
              <Button onClick={connect} disabled={connecting}>
                {connecting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Plug className="w-4 h-4 mr-1.5" />}
                {connecting ? "Connecting..." : "Connect Calendly"}
              </Button>
            )}
            {connected && canAdmin && (
              <>
                <Button variant="outline" size="sm" onClick={syncEventTypes} disabled={syncing}>
                  {syncing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                  {syncing ? "Syncing..." : "Sync event types"}
                </Button>
                <Button variant="outline" size="sm" onClick={disconnect}>
                  Disconnect
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Event types */}
      {connected && eventTypes.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold text-slate-800 mb-3">Event types</h3>
            <div className="space-y-2">
              {eventTypes.map((et) => (
                <div key={et.id} className="flex items-center justify-between border border-slate-200 rounded-lg p-3">
                  <div>
                    <div className="text-sm font-medium text-slate-800">{et.display_name}</div>
                    <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                      <span>{et.duration_minutes} min</span>
                      <span>·</span>
                      <span className={et.supported ? "text-emerald-600" : "text-amber-600"}>
                        {et.supported ? "Individual (supported)" : "Group/round-robin (not supported)"}
                      </span>
                    </div>
                  </div>
                  <a href={et.scheduling_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Link-only mode notice */}
      {!connected && (
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold text-slate-800 mb-1">Link-only mode</h3>
            <p className="text-xs text-slate-500 mb-3">
              Without connecting your Calendly account, you can still paste a scheduling URL in each funnel's Booking tab.
              Bookings won't be tracked automatically — you'll need to record them manually.
            </p>
            <p className="text-xs text-slate-400">
              To enable automatic booking tracking, connect your account above. Calendly requires a paid plan for webhook-based automatic confirmation.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default CalendlyTab;