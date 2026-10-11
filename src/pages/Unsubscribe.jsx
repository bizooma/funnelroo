import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { MascotBadge } from "@/components/MascotBadge";
import { Loader2, CheckCircle2, Mail } from "lucide-react";

// Public unsubscribe page. No login required. Uses an opaque token scoped
// to workspace + contact. GET (page load) only shows a confirmation page —
// no state change. The visitor must click "Unsubscribe" to trigger the POST.
export default function Unsubscribe() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [unsubscribing, setUnsubscribing] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await base44.functions.invoke("unsubscribeAccess", { action: "getInfo", token });
        if (res.status === 200) {
          setInfo(res.data);
        } else {
          setError(res.data?.error || "Invalid link");
        }
      } catch (e) {
        setError(e.response?.data?.error || "Invalid or expired link");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function handleUnsubscribe() {
    setUnsubscribing(true);
    try {
      await base44.functions.invoke("unsubscribeAccess", { action: "unsubscribe", token });
      setDone(true);
    } catch (e) {
      setError(e.response?.data?.error || "Could not process");
    } finally {
      setUnsubscribing(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-7 h-7 text-slate-400 animate-spin" />
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 text-center px-6">
        <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center mb-4">
          <CheckCircle2 className="w-7 h-7 text-emerald-600" />
        </div>
        <h1 className="text-xl font-semibold text-slate-800">You're unsubscribed</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-sm">
          You won't receive further follow-up emails from this business. This won't affect any resources you've already requested.
        </p>
        <div className="mt-6 flex items-center gap-2 text-xs text-slate-400">
          <MascotBadge size={20} />
          <span>Powered by FunnelRoo</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 text-center px-6">
        <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <Mail className="w-7 h-7 text-slate-400" />
        </div>
        <h1 className="text-lg font-semibold text-slate-700">This link isn't valid</h1>
        <p className="text-sm text-slate-500 mt-1.5 max-w-sm">{error}. The link may have expired or been corrupted.</p>
        <div className="mt-6 flex items-center gap-2 text-xs text-slate-400">
          <MascotBadge size={20} />
          <span>Powered by FunnelRoo</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-indigo-100 flex items-center justify-center mb-4 mx-auto">
          <Mail className="w-7 h-7 text-indigo-600" />
        </div>
        <h1 className="text-xl font-semibold text-slate-800">Confirm unsubscribe</h1>
        <p className="text-sm text-slate-500 mt-2">
          {info?.first_name ? `Hi ${info.first_name}, ` : ""}confirm to stop receiving follow-up emails from this business sent via FunnelRoo.
        </p>
        <p className="text-xs text-slate-400 mt-1">{info?.email}</p>
        <Button className="mt-6 w-full" disabled={unsubscribing} onClick={handleUnsubscribe}>
          {unsubscribing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
          {unsubscribing ? "Processing..." : "Unsubscribe"}
        </Button>
        <p className="text-xs text-slate-400 mt-3">
          This won't affect any resources you've already requested.
        </p>
      </div>
    </div>
  );
}