import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { Loader2, Sparkles, Rocket, AlertTriangle, ExternalLink, CreditCard } from "lucide-react";

// Settings → Billing tab. Shows plan, trial, and usage meters. Owners get real
// hosted Checkout, Stripe Customer Portal, and cancellation. Fail-closed: if
// Stripe test keys are not configured, actions surface an honest message rather
// than a fabricated URL.
export default function BillingTab() {
  const { current } = useWorkspace();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // "checkout:starter:monthly" | "portal" | "trial"
  const [interval, setInterval] = useState("monthly");
  const [configError, setConfigError] = useState(null);

  async function load() {
    if (!current) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke("billingAccess", {
        action: "getBillingSummary",
        workspace_id: current.id,
      });
      setSummary(res.data?.summary);
    } catch (e) {
      toast({ title: "Load failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [current]);

  function reportError(e, fallback) {
    const status = e.response?.status;
    const msg = e.response?.data?.error || e.message;
    if (status === 503) setConfigError(msg);
    else toast({ title: fallback, description: msg, variant: "destructive" });
  }

  async function startTrial() {
    setBusy("trial");
    setConfigError(null);
    try {
      await base44.functions.invoke("billingAccess", { action: "startTrial", workspace_id: current.id });
      toast({ title: "Trial started", description: "Your 14-day free trial is active." });
      load();
    } catch (e) {
      reportError(e, "Trial failed");
    } finally {
      setBusy(null);
    }
  }

  async function checkout(planId) {
    setBusy(`checkout:${planId}`);
    setConfigError(null);
    try {
      const res = await base44.functions.invoke("stripeCheckout", {
        workspace_id: current.id,
        plan: planId,
        interval,
        origin: window.location.origin,
      });
      if (res.data?.url) window.location.href = res.data.url;
      else reportError({ message: "Checkout could not be started." }, "Checkout failed");
    } catch (e) {
      reportError(e, "Checkout failed");
    } finally {
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy("portal");
    setConfigError(null);
    try {
      const res = await base44.functions.invoke("stripePortal", {
        workspace_id: current.id,
        origin: window.location.origin,
      });
      if (res.data?.url) window.location.href = res.data.url;
      else reportError({ message: "Billing management could not be opened." }, "Portal failed");
    } catch (e) {
      reportError(e, "Portal failed");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (!summary) return null;

  const isOwner = summary.is_owner;
  const meters = summary.usage?.meters || {};
  const resetDate = summary.usage?.reset_date;
  const customerOnly = summary.status === "read_only" && !summary.plan && !summary.trial;
  const noPlan = summary.access_state === "none" || customerOnly;

  return (
    <div className="space-y-6">
      {configError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{configError}</span>
        </div>
      )}

      {/* Plan header */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">Current plan</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {summary.plan_name || (summary.access_state === "legacy_access" ? "Legacy access" : "No active plan")}
              </div>
              {summary.interval && <div className="text-sm text-slate-500 capitalize">{summary.interval} billing</div>}
              {summary.status === "trial" && summary.trial && (
                <div className="mt-1 text-sm text-emerald-700">
                  Trial · {summary.trial.days_remaining} days remaining (ends {fmtDate(summary.trial.ends_at)})
                </div>
              )}
              {summary.cancel_at_period_end && summary.paid_through && (
                <div className="mt-1 text-sm text-amber-700">
                  Cancellation scheduled — plan available until {fmtDate(summary.paid_through)}
                </div>
              )}
              {summary.pending_change && (
                <div className="mt-1 text-sm text-slate-500">
                  Scheduled change to {summary.pending_change.target_plan} {summary.pending_change.target_interval}
                </div>
              )}
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full capitalize ${badgeClass(summary.access_state)}`}>
              {labelFor(summary.access_state)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Trial start */}
      {isOwner && noPlan && (
        <Card>
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-slate-800">Start your 14-day free trial</h3>
                <p className="text-sm text-slate-500 mt-1">
                  No credit card required. Prepare your marketing, build a funnel, and follow up with leads. Choose a paid plan when you're ready.
                </p>
                <ul className="mt-3 text-sm text-slate-600 space-y-1">
                  <li>1 live funnel · 2 team users · 100 contacts</li>
                  <li>100 email sends · 20 AI text actions · 3 images (totals for 14 days)</li>
                </ul>
                <Button className="mt-4" onClick={startTrial} disabled={busy === "trial"}>
                  {busy === "trial" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Rocket className="w-4 h-4 mr-1.5" />}
                  Start free trial
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Usage meters */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800">Usage this period</h3>
            {resetDate && <span className="text-xs text-slate-400">Resets {fmtDate(resetDate)}</span>}
          </div>
          <div className="space-y-4">
            <Meter label="Live funnels" m={meters.live_funnels} />
            <Meter label="Team users" m={meters.team_users} />
            <Meter label="Stored contacts" m={meters.contacts} />
            <Meter label="Email sends" m={meters.email_sends} />
            <Meter label="AI text actions" m={meters.ai_text_actions} />
            <Meter label="Generated images" m={meters.images} />
          </div>
        </CardContent>
      </Card>

      {/* Owner actions */}
      {isOwner && (
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold text-slate-800 mb-1">Manage your plan</h3>
            <p className="text-sm text-slate-500 mb-4">
              Checkout runs on Stripe's hosted page. Update payment method, view invoices, change plan, and cancel in the Stripe billing portal.
            </p>

            <div className="flex items-center gap-2 mb-4">
              <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 p-1">
                <button onClick={() => setInterval("monthly")} className={`px-3 py-1 text-xs font-medium rounded-full ${interval === "monthly" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>Monthly</button>
                <button onClick={() => setInterval("annual")} className={`px-3 py-1 text-xs font-medium rounded-full ${interval === "annual" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>Annual</button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {["starter", "growth"].map((planId) => {
                const isCurrent = summary.plan === planId;
                return (
                  <div key={planId} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-800 capitalize">{planId}</span>
                      {isCurrent && <span className="text-[10px] uppercase bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">Current</span>}
                    </div>
                    <Button
                      className="mt-3 w-full"
                      variant={isCurrent ? "outline" : "default"}
                      onClick={() => checkout(planId)}
                      disabled={busy === `checkout:${planId}`}
                    >
                      {busy === `checkout:${planId}` ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                      {isCurrent ? "Change billing interval" : summary.plan ? "Switch to plan" : "Choose plan"}
                    </Button>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" onClick={openPortal} disabled={busy === "portal" || !summary.status || noPlan}>
                {busy === "portal" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CreditCard className="w-4 h-4 mr-1.5" />}
                Update payment / manage billing
              </Button>
              <Button variant="ghost" asChild>
                <Link to="/pricing">Compare plans <ExternalLink className="w-3.5 h-3.5 ml-1" /></Link>
              </Button>
            </div>

            <div className="mt-4 flex items-start gap-2 text-xs text-slate-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Checkout and billing management use Stripe test mode. No real charges are made, and no existing access is restricted.</span>
            </div>
          </CardContent>
        </Card>
      )}

      {!isOwner && (
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-600">
              Only the workspace owner can manage billing. Ask your workspace owner to choose a plan or start a trial.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Meter({ label, m }) {
  if (!m) return null;
  const used = m.used || 0;
  const allowance = m.allowance;
  const reserved = m.reserved || 0;
  if (allowance == null) {
    return (
      <div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-600">{label}</span>
          <span className="text-slate-500">{used} used</span>
        </div>
        <div className="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full bg-slate-300" style={{ width: "0%" }} />
        </div>
      </div>
    );
  }
  const pct = allowance > 0 ? Math.min(100, Math.round((used / allowance) * 100)) : 0;
  const remaining = Math.max(0, allowance - used);
  const barColor = pct >= 100 ? "bg-rose-500" : pct >= 95 ? "bg-amber-500" : pct >= 80 ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="text-slate-500">
          {used.toLocaleString()} / {allowance.toLocaleString()}
          {reserved > 0 && <span className="text-slate-400"> · {reserved.toLocaleString()} reserved</span>}
          <span className="text-slate-400"> · {remaining.toLocaleString()} left</span>
        </span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      {pct >= 80 && (
        <p className={`mt-1 text-xs ${pct >= 100 ? "text-rose-600" : "text-amber-600"}`}>
          {pct >= 100 ? "Limit reached" : `Approaching limit (${pct}%)`}
        </p>
      )}
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  } catch {
    return iso;
  }
}

function labelFor(state) {
  return {
    none: "No plan",
    trial: "Trial",
    paid: "Active",
    payment_grace: "Payment due",
    read_only: "Read only",
    legacy_access: "Legacy access",
  }[state] || state;
}

function badgeClass(state) {
  return {
    none: "bg-slate-100 text-slate-600",
    trial: "bg-emerald-100 text-emerald-700",
    paid: "bg-indigo-100 text-indigo-700",
    payment_grace: "bg-amber-100 text-amber-700",
    read_only: "bg-slate-100 text-slate-500",
    legacy_access: "bg-violet-100 text-violet-700",
  }[state] || "bg-slate-100 text-slate-600";
}