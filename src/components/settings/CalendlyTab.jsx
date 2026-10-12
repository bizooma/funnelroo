import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import {
  Loader2, Plug, Check, AlertCircle, RefreshCw, ExternalLink, Calendar,
  Users, CalendarCheck, Wrench, ChevronDown, ChevronUp,
} from "lucide-react";
import CalendlyLimitationNotice from "@/components/settings/CalendlyLimitationNotice";

export function CalendlyTab() {
  const { current, canAdmin } = useWorkspace();
  const [status, setStatus] = useState(null);
  const [eventTypes, setEventTypes] = useState([]);
  const [followUpStatus, setFollowUpStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showSupport, setShowSupport] = useState(false);

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
      const fuRes = await base44.functions.invoke("calendlyAccess", { action: "getFollowUpStatus", workspace_id: current.id });
      setFollowUpStatus(fuRes.data);
      if (!res.data?.connected) {
        setEventTypes([]);
      }
    } catch (e) {
      toast({ title: "Could not load calendar status", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [current]);

  async function connect() {
    if (!current) return;
    setConnecting(true);
    try {
      const res = await base44.functions.invoke("calendlyAccess", { action: "authorize", workspace_id: current.id });
      if (res.data?.auth_url) window.location.href = res.data.auth_url;
    } catch (e) {
      toast({ title: "Could not start connection", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setConnecting(false);
    }
  }

  async function refreshAppointmentTypes() {
    setSyncing(true);
    try {
      const res = await base44.functions.invoke("calendlyAccess", { action: "syncEventTypes", workspace_id: current.id });
      setEventTypes(res.data?.event_types || []);
      toast({ title: `Refreshed ${res.data?.synced || 0} appointment types` });
      load();
    } catch (e) {
      toast({ title: "Refresh failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  async function checkConnection() {
    setChecking(true);
    try {
      const res = await base44.functions.invoke("calendlyAccess", { action: "checkConnection", workspace_id: current.id });
      if (res.data?.connected === false && res.data?.reason === "expired_authorization") {
        toast({ title: "Reconnect required", description: "Your Calendly authorization has expired.", variant: "destructive" });
      } else if (res.data?.webhook_health === "healthy") {
        toast({ title: "Connection verified", description: "Instant booking updates are active." });
      } else if (["free_plan", "plan_restriction"].includes(res.data?.booking_update_restriction)) {
        toast({ title: "Connection verified", description: "Instant booking updates remain unavailable on your current Calendly plan." });
      } else {
        toast({ title: "Connection checked", description: "Instant booking updates are still unavailable. Try again later." });
      }
      load();
    } catch (e) {
      toast({ title: "Check failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setChecking(false);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect your calendar? Automatic booking tracking will stop. Historical appointments are preserved.")) return;
    try {
      await base44.functions.invoke("calendlyAccess", { action: "disconnect", workspace_id: current.id });
      toast({ title: "Calendar disconnected" });
      load();
    } catch (e) {
      toast({ title: "Failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    }
  }

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 text-slate-300 animate-spin" /></div>;

  const connected = status?.connected;
  const configured = status?.configured;
  const instantUpdates = status?.webhook_health === "healthy";
  const freePlan = ["free_plan", "plan_restriction"].includes(status?.booking_update_restriction);
  const setupFailed = status?.webhook_health === "failed";
  const reconnectRequired = status?.status === "reconnect_required";
  const followUpPaused = followUpStatus?.paused === true;
  const backgroundChecksWorking = !!status?.last_booking_check_success_at;
  const noCheckYet = !status?.last_booking_check_success_at;
  const lastCheck = status?.last_booking_check_success_at ? new Date(status.last_booking_check_success_at).toLocaleString() : null;

  // Status badge — "Connected · Limited booking updates" when updates are limited
  const badge = reconnectRequired ? { label: "Reconnect required", cls: "bg-amber-100 text-amber-700", icon: AlertCircle } : !connected
    ? status?.status === "link_only"
      ? { label: "Link-only", cls: "bg-slate-100 text-slate-500", icon: null }
      : { label: "Not connected", cls: "bg-slate-100 text-slate-400", icon: null }
    : reconnectRequired
      ? { label: "Reconnect required", cls: "bg-amber-100 text-amber-700", icon: AlertCircle }
      : instantUpdates
        ? { label: "Connected", cls: "bg-emerald-100 text-emerald-700", icon: Check }
        : { label: "Connected · Limited booking updates", cls: "bg-amber-100 text-amber-700", icon: AlertCircle };

  return (
    <div className="space-y-4">
      {/* Connection card */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-indigo-600" /> Calendar
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md">
                Connect your Calendly account to track confirmed appointments, stop follow-up emails on booking, and report on conversion.
              </p>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1 ${badge.cls}`}>
              {badge.icon && <badge.icon className="w-3 h-3" />}
              {badge.label}
            </span>
          </div>

          {/* Four concerns separated */}
          {connected && (
            <div className="mt-4 space-y-3">
              <StatusRow label="Account authorization">
                {reconnectRequired ? (
                  <span className="flex items-center gap-1.5 text-amber-600"><AlertCircle className="w-3.5 h-3.5" /> Expired — reconnect required</span>
                ) : (
                  <span className="flex items-center gap-1.5 text-slate-700"><Check className="w-3.5 h-3.5 text-emerald-500" /> {status.provider_user_name || "Connected"} <span className="text-xs text-slate-400">{status.provider_user_email}</span></span>
                )}
              </StatusRow>

              <StatusRow label="Booking updates">
                {instantUpdates ? (
                  <span className="flex items-center gap-1.5 text-emerald-600"><Check className="w-3.5 h-3.5" /> Active</span>
                ) : freePlan ? (
                  <span className="flex items-center gap-1.5 text-amber-600"><AlertCircle className="w-3.5 h-3.5" /> Instant updates unavailable — current Calendly plan</span>
                ) : setupFailed ? (
                  <span className="flex items-center gap-1.5 text-amber-600"><AlertCircle className="w-3.5 h-3.5" /> Setup did not complete — try checking your connection</span>
                ) : (
                  <span className="flex items-center gap-1.5 text-amber-600"><AlertCircle className="w-3.5 h-3.5" /> Unavailable</span>
                )}
              </StatusRow>

              <StatusRow label="Last successful appointment check">
                <span className="text-slate-600">{noCheckYet ? "No appointment check completed yet" : lastCheck}
                  {status?.booking_check_status === "failed" && <span className="block text-xs text-amber-600">The latest attempt failed; it does not replace the last successful check.</span>}
                  {status?.booking_check_status === "partial" && <span className="block text-xs text-muted-foreground">An appointment check is still in progress; results may be incomplete.</span>}
                </span>
              </StatusRow>

              <StatusRow label="Booking follow-up">
                {followUpPaused ? (
                  <span className="flex items-center gap-1.5 text-amber-600"><AlertCircle className="w-3.5 h-3.5" /> Booking follow-up paused</span>
                ) : (
                  <span className="text-slate-600">{followUpStatus?.state === "running" ? "Running" : followUpStatus?.state === "paused" ? "Paused by your sending settings" : followUpStatus?.state === "not_configured" ? "Not configured" : "Status not confirmed"}</span>
                )}
              </StatusRow>
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {!configured && (
              <p className="text-xs text-amber-600">Calendar connection setup is unavailable. Please contact your account administrator.</p>
            )}
            {!connected && configured && canAdmin && (
              <Button onClick={connect} disabled={connecting}>
                {connecting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Plug className="w-4 h-4 mr-1.5" />}
                {connecting ? "Connecting..." : "Connect Calendly"}
              </Button>
            )}
            {connected && canAdmin && (
              <>
                <Button variant="outline" size="sm" onClick={checkConnection} disabled={checking}>
                  {checking ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5 mr-1.5" />}
                  {checking ? "Checking..." : "Check connection"}
                </Button>
                <Button variant="outline" size="sm" onClick={refreshAppointmentTypes} disabled={syncing}>
                  {syncing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                  {syncing ? "Refreshing..." : "Refresh appointment types"}
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/contacts"><Users className="w-3.5 h-3.5 mr-1.5" /> View contacts</Link>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/appointments?record=1"><CalendarCheck className="w-3.5 h-3.5 mr-1.5" /> Record appointment</Link>
                </Button>
                {freePlan && (
                  <Button variant="outline" size="sm" asChild>
                    <a href="https://calendly.com/pricing" target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3.5 h-3.5 mr-1.5" /> View Calendly plans</a>
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={disconnect}>Disconnect</Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Free-plan limitation notice — only when cause is established */}
      {connected && !instantUpdates && !reconnectRequired && (
        <CalendlyLimitationNotice
          followUpPaused={followUpPaused}
          followUpState={followUpStatus?.state}
          restriction={status?.booking_update_restriction}
          affectedCount={followUpStatus?.affected_count}
          backgroundChecksWorking={backgroundChecksWorking}
          lastCheck={lastCheck}
          affectedFunnels={followUpStatus?.affected}
        />
      )}

      {/* Reconnect required notice */}
      {reconnectRequired && (
        <Card className="border-amber-200">
          <CardContent className="p-5">
            <h3 className="font-semibold text-slate-800 mb-1 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500" /> Reconnect your calendar
            </h3>
            <p className="text-sm text-slate-600 mb-3">
              Your Calendly authorization has expired. FunnelRoo can't check for new
              appointments or update booking information until you reconnect.
            </p>
            {canAdmin && (
              <Button onClick={connect} disabled={connecting}>
                {connecting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Plug className="w-4 h-4 mr-1.5" />}
                {connecting ? "Connecting..." : "Reconnect Calendly"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Setup failure notice (not free plan, not expired) */}
      {connected && setupFailed && !reconnectRequired && !freePlan && (
        <Card className="border-amber-200">
          <CardContent className="p-5">
            <h3 className="font-semibold text-slate-800 mb-1 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500" /> Booking updates did not finish setting up
            </h3>
            <p className="text-sm text-slate-600 mb-3">
              Your account is connected, but instant booking updates could not be set
              up. This is often temporary. Try checking your connection to repair the
              setup.
            </p>
            {canAdmin && (
              <Button variant="outline" size="sm" onClick={checkConnection} disabled={checking}>
                {checking ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5 mr-1.5" />}
                {checking ? "Checking..." : "Check connection"}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Appointment types */}
      {connected && eventTypes.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold text-slate-800 mb-3">Appointment types</h3>
            <div className="space-y-2">
              {eventTypes.map((et) => (
                <div key={et.id} className="flex items-center justify-between border border-slate-200 rounded-lg p-3">
                  <div>
                    <div className="text-sm font-medium text-slate-800">{et.display_name}</div>
                    <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                      <span>{et.duration_minutes} min</span>
                      <span>·</span>
                      <span className={et.supported ? "text-emerald-600" : "text-amber-600"}>
                        {et.supported ? "Individual" : "Group/round-robin (not supported)"}
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

      {/* Link-only mode */}
      {!connected && (
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold text-slate-800 mb-1">Link-only mode</h3>
            <p className="text-xs text-slate-500 mb-3">
              Without connecting your Calendly account, you can still paste a
              scheduling URL in each funnel's Booking tab. Bookings won't be tracked
              automatically — you'll need to record them manually.
            </p>
            <p className="text-xs text-slate-400">
              To enable automatic booking tracking, connect your account above.
              Available booking updates will be checked after connection.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Support details (collapsible, no secrets) */}
      {connected && (
        <Card>
          <CardContent className="p-5">
            <button
              onClick={() => setShowSupport(!showSupport)}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
            >
              {showSupport ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              Support details
            </button>
            {showSupport && (
              <div className="mt-3 space-y-1 text-xs text-slate-500 font-mono">
                <div>Connection status: {status?.status || "—"}</div>
                <div>Booking updates: {status?.webhook_health || "—"}</div>
                <div>Plan supports instant updates: {String(status?.plan_supports_webhooks ?? "—")}</div>
                <div>Last successful appointment check: {lastCheck || "None confirmed"}</div>
                <div>Latest check attempt: {status?.last_booking_check_attempt_at || "None"}</div>
                <div>Check status: {status?.booking_check_status || "never"}</div>
                <div>Plan restriction evidence: {status?.booking_update_restriction || "unknown"}</div>
                <div>Follow-up paused: {String(status?.outage_hold ?? false)}</div>
                <div>Generation: {status?.generation || "—"}</div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusRow({ label, children }) {
  return (
    <div className="flex items-start gap-2">
      <div className="text-xs text-slate-400 w-40 shrink-0 pt-0.5">{label}</div>
      <div className="text-sm flex-1">{children}</div>
    </div>
  );
}

export default CalendlyTab;