import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useWorkspace } from "@/lib/workspaceContext";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, Clock, AlertTriangle } from "lucide-react";

// Billing return page. The URL alone is not proof of payment: this calls the
// authenticated stripeReturn function, which verifies the session against Stripe
// and syncs. The webhook is the parallel authoritative path — activation never
// depends on this page being visited.
const MAX_AUTO_RECHECKS = 5;
const RECHECK_DELAY_MS = 3000;

const PLAN_LABEL = { starter: "Starter", growth: "Growth" };
const INTERVAL_LABEL = { monthly: "monthly", annual: "annual" };

export default function CheckoutReturn() {
  const { workspaces, current, switchWorkspace, refresh } = useWorkspace();
  const [state, setState] = useState("verifying"); // verifying | verified | pending | error
  const [detail, setDetail] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const sessionId = new URLSearchParams(window.location.search).get("session_id");
  const timer = useRef(null);
  const started = useRef(false);

  // Select the workspace the purchase actually belongs to, even if another
  // workspace was last selected in this browser.
  const selectWorkspace = useCallback(
    async (wsId) => {
      if (!wsId) return;
      const match = workspaces.find((w) => w.id === wsId);
      if (match) {
        if (current?.id !== match.id) await switchWorkspace(match);
        return;
      }
      if (current?.id !== wsId) {
        localStorage.setItem("fr_current_ws", wsId);
        await refresh();
      }
    },
    [workspaces, current, switchWorkspace, refresh]
  );

  const verify = useCallback(async () => {
    if (!sessionId) {
      setState("error");
      setDetail("This link is missing its checkout session.");
      return;
    }
    setState("verifying");
    try {
      const res = await base44.functions.invoke("stripeReturn", { session_id: sessionId });
      const data = res.data || {};
      setDetail(data);
      if (data.verified) {
        await selectWorkspace(data.workspace_id);
        setState("verified");
        return;
      }
      setState("pending");
    } catch (e) {
      setState("error");
      setDetail(e.response?.data?.error || e.message);
    }
  }, [sessionId, selectWorkspace]);

  // Verify once on arrival. Selecting the verified workspace changes context
  // identity, so this must not re-run on that change.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    verify();
  }, [verify]);

  // Bounded automatic rechecks while Stripe finishes reporting the payment.
  useEffect(() => {
    if (state !== "pending" || attempt >= MAX_AUTO_RECHECKS) return;
    timer.current = setTimeout(() => {
      setAttempt((n) => n + 1);
      verify();
    }, RECHECK_DELAY_MS);
    return () => clearTimeout(timer.current);
  }, [state, attempt, verify]);

  const retry = () => {
    setAttempt(0);
    verify();
  };

  const workspaceName =
    workspaces.find((w) => w.id === detail?.workspace_id)?.name || current?.name || "your workspace";
  const planLabel = PLAN_LABEL[detail?.plan] || null;
  const intervalLabel = INTERVAL_LABEL[detail?.interval] || null;

  return (
    <div className="min-h-screen bg-[#f7f8fa] flex items-center justify-center px-5">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-7 text-center">
        {state === "verifying" && (
          <>
            <Loader2 className="w-10 h-10 animate-spin text-indigo-500 mx-auto" />
            <h1 className="mt-4 text-lg font-semibold text-slate-900">Confirming your subscription…</h1>
            <p className="mt-1.5 text-sm text-slate-500">Checking with Stripe. This takes a moment.</p>
          </>
        )}

        {state === "verified" && (
          <>
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <h1 className="mt-4 text-lg font-semibold text-slate-900">You're all set</h1>
            <p className="mt-1.5 text-sm text-slate-500">
              {planLabel ? `${planLabel}${intervalLabel ? ` (${intervalLabel})` : ""} is active for ` : "Your subscription is active for "}
              <span className="font-medium text-slate-700">{workspaceName}</span>.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Button asChild>
                <Link to="/app">Continue to dashboard</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/settings?tab=billing">View billing</Link>
              </Button>
            </div>
          </>
        )}

        {state === "pending" && (
          <>
            <Clock className="w-10 h-10 text-amber-500 mx-auto" />
            <h1 className="mt-4 text-lg font-semibold text-slate-900">Finalizing your subscription</h1>
            {attempt < MAX_AUTO_RECHECKS ? (
              <p className="mt-1.5 text-sm text-slate-500">
                Stripe is still confirming this payment. Checking again automatically…
              </p>
            ) : (
              <p className="mt-1.5 text-sm text-slate-500">
                Stripe hasn't confirmed this subscription yet. That is a normal delay, and your access activates as
                soon as the payment is verified even if you leave this page.
              </p>
            )}
            <div className="mt-5 flex flex-col gap-2">
              {attempt >= MAX_AUTO_RECHECKS && (
                <Button onClick={retry}>Check again</Button>
              )}
              <Button asChild variant="outline">
                <Link to="/settings?tab=billing">Go to billing</Link>
              </Button>
            </div>
          </>
        )}

        {state === "error" && (
          <>
            <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto" />
            <h1 className="mt-4 text-lg font-semibold text-slate-900">We couldn't confirm this</h1>
            <p className="mt-1.5 text-sm text-slate-500">{typeof detail === "string" ? detail : "Please check your billing settings."}</p>
            {sessionId && (
              <div className="mt-5 flex flex-col gap-2">
                <Button onClick={retry}>Check again</Button>
                <Button asChild variant="outline">
                  <Link to="/settings?tab=billing">Go to billing</Link>
                </Button>
              </div>
            )}
            {!sessionId && (
              <Button asChild className="mt-5" variant="outline">
                <Link to="/settings?tab=billing">Go to billing</Link>
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}