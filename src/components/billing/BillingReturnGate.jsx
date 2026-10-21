import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Loader2, LockKeyhole } from "lucide-react";
import CheckoutReturn from "@/pages/CheckoutReturn";
import { legacyReturnRedirect } from "@/lib/appOrigins";

// Gate for /billing/return.
//
// 1. A legacy return link on an alias host (backend host / www) has no session
//    here, so it is handed to the canonical route with only the session id.
// 2. Otherwise this waits for the existing authentication check to finish
//    before deciding anything — no login flash while auth is still loading.
// 3. A genuinely expired session gets a branded explanation that preserves the
//    local destination and the Checkout Session id through login. A Stripe
//    Session id or payment email never identifies or signs anyone in.
// 4. Authorization stays where it belongs: the backend verifies the session and
//    requires membership of that workspace before returning any billing state.
export default function BillingReturnGate() {
  const { isAuthenticated, isLoadingAuth, authChecked } = useAuth();

  const legacyTarget = legacyReturnRedirect();
  useEffect(() => {
    if (legacyTarget) window.location.replace(legacyTarget);
  }, [legacyTarget]);

  if (legacyTarget) return null;

  if (isLoadingAuth || !authChecked) {
    return (
      <Shell>
        <Loader2 className="w-10 h-10 animate-spin text-indigo-500 mx-auto" />
        <h1 className="mt-4 text-lg font-semibold text-slate-900">Confirming your subscription…</h1>
        <p className="mt-1.5 text-sm text-slate-500">Checking your account and your payment.</p>
      </Shell>
    );
  }

  if (!isAuthenticated) {
    const returnTo = window.location.pathname + window.location.search;
    return (
      <Shell>
        <LockKeyhole className="w-10 h-10 text-slate-400 mx-auto" />
        <h1 className="mt-4 text-lg font-semibold text-slate-900">Please sign in to finish confirming your subscription.</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Your payment is safe. Sign in with the account that owns this workspace and we'll finish confirming it.
        </p>
        <Button asChild className="mt-5">
          <Link to={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in</Link>
        </Button>
      </Shell>
    );
  }

  // WorkspaceProvider is mounted by the route (src/App.jsx), so the confirmation
  // has workspace context without this gate having to own the provider.
  return <CheckoutReturn />;
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-[#f7f8fa] flex items-center justify-center px-5">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-7 text-center">{children}</div>
    </div>
  );
}