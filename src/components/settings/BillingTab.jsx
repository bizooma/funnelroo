import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { Loader2, Sparkles, Rocket, AlertTriangle, Check } from "lucide-react";

// Settings → Billing tab. Shows the workspace's plan, trial, and usage
// meters. The no-card trial can be started here (owner only). Stripe checkout,
// portal, upgrade, and cancellation actions are wired in the next phase once
// Stripe test-mode keys are configured; until then they're clearly labeled.
export default function BillingTab() {
  const { current, canAdmin } = useWorkspace();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

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

  async function startTrial() {
    setStarting(true);
    try {
      await base44.functions.invoke("billingAccess", { action: "startTrial", workspace_id: current.id });
      toast({ title: "Trial started", description: "Your 14-day free trial is active." });
      load();
    } catch (e) {
      toast({ title: "Trial failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setStarting(false);
    }
  }

  if (loading) return <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (!summary) return null;

  const isOwner = summary.is_owner;
  const meters = summary.usage?.meters || {};
  const resetDate = summary.usage?.reset_date;

  return (
    <div className="space-y-6">
      {/* Plan header */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">Current plan</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {summary.plan_name || (summary.access_state === "legacy_access" ? "Legacy access" : "No active plan")}
              </div>
              {summary.interval && (
                <div className="text-sm text-slate-500 capitalize">{summary.interval} billing</div>
              )}
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
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full capitalize ${badgeClass(summary.access_state)}`}>
              {labelFor(summary.access_state)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Trial start / no active plan */}
      {isOwner && summary.access_state === "none" && (
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
                <Button className="mt-4" onClick={startTrial} disabled={starting}>
                  {starting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Rocket className="w-4 h-4 mr-1.5" />}
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
          {Object.values(meters).some((m) => m && m.allowance == null) && (
            <p className="mt-4 text-xs text-slate-400">
              Allowances appear once a trial or paid plan is active. Manual editing, viewing saved assets, and downloading existing cards don't consume AI allowance.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Owner actions (Stripe checkout — next phase) */}
      {isOwner ? (
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold text-slate-800 mb-1">Manage your plan</h3>
            <p className="text-sm text-slate-500 mb-4">
              Choose a plan, update payment method, view invoices, and cancel are available here once Stripe test-mode checkout is configured.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <Link to="/pricing">Compare plans</Link>
              </Button>
              <Button variant="outline" disabled title="Available once Stripe test checkout is configured">
                Choose / upgrade plan
              </Button>
              <Button variant="outline" disabled title="Available once Stripe is configured">
                Update payment method
              </Button>
              <Button variant="outline" disabled title="Available once Stripe is configured">
                View invoices
              </Button>
              <Button variant="outline" disabled title="Available once Stripe is configured">
                Cancel renewal
              </Button>
            </div>
            <div className="mt-4 flex items-start gap-2 text-xs text-slate-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Checkout is being configured in Stripe test mode. No real charges are made and no existing access is restricted during setup.</span>
            </div>
          </CardContent>
        </Card>
      ) : (
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