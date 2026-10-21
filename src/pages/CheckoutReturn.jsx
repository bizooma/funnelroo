import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, Clock, AlertTriangle } from "lucide-react";

// Checkout return page. The URL alone is not proof of payment — this calls the
// authenticated stripeReturn function, which verifies the session against
// Stripe and syncs. The webhook is the parallel authoritative path.
export default function CheckoutReturn() {
  const [state, setState] = useState("verifying");
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) {
      setState("error");
      setDetail("Missing checkout session.");
      return;
    }
    base44.functions
      .invoke("stripeReturn", { session_id: sessionId })
      .then((res) => {
        const d = res.data;
        setDetail(d);
        if (d?.verified) setState("verified");
        else if (d?.reason === "not_paid_yet") setState("pending");
        else setState("pending");
      })
      .catch((e) => {
        setState("error");
        setDetail(e.response?.data?.error || e.message);
      });
  }, []);

  return (
    <div className="min-h-screen bg-[#f7f8fa] flex items-center justify-center px-5">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-7 text-center">
        {state === "verifying" && (
          <>
            <Loader2 className="w-10 h-10 animate-spin text-indigo-500 mx-auto" />
            <h1 className="mt-4 text-lg font-semibold text-slate-900">Confirming your payment</h1>
            <p className="mt-1.5 text-sm text-slate-500">Checking with Stripe. This takes a moment.</p>
          </>
        )}
        {state === "verified" && (
          <>
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <h1 className="mt-4 text-lg font-semibold text-slate-900">You're all set</h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Your {detail?.plan ? detail.plan[0].toUpperCase() + detail.plan.slice(1) : "subscription"} is active for this workspace.
            </p>
            <Button asChild className="mt-5">
              <Link to="/settings?tab=billing">Go to billing</Link>
            </Button>
          </>
        )}
        {state === "pending" && (
          <>
            <Clock className="w-10 h-10 text-amber-500 mx-auto" />
            <h1 className="mt-4 text-lg font-semibold text-slate-900">Finalizing</h1>
            <p className="mt-1.5 text-sm text-slate-500">
              Your payment is still being confirmed. This page updates once Stripe reports the subscription as active — you can also check Billing in a moment.
            </p>
            <Button asChild className="mt-5" variant="outline">
              <Link to="/settings?tab=billing">Go to billing</Link>
            </Button>
          </>
        )}
        {state === "error" && (
          <>
            <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto" />
            <h1 className="mt-4 text-lg font-semibold text-slate-900">We couldn't confirm this</h1>
            <p className="mt-1.5 text-sm text-slate-500">{typeof detail === "string" ? detail : "Please check your billing settings."}</p>
            <Button asChild className="mt-5" variant="outline">
              <Link to="/settings?tab=billing">Go to billing</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}