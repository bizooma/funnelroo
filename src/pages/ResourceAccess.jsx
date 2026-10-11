import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { MascotBadge } from "@/components/MascotBadge";
import { Loader2, Download, ExternalLink, FileX, Clock, ShieldOff } from "lucide-react";

// Stable FunnelRoo resource-access route. Validates the grant server-side and
// issues a fresh short-lived download URL (file) or redirects (external).
// Never exposes private storage paths to the visitor.
export default function ResourceAccess() {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true, data: null, error: "" });

  useEffect(() => {
    (async () => {
      try {
        const res = await base44.functions.invoke("resolveResourceGrant", { token });
        if (res.status === 200) {
          const d = res.data;
          if (d.delivery_type === "external" && d.external_url) {
            window.location.href = d.external_url;
            return;
          }
          setState({ loading: false, data: d, error: "" });
        } else {
          setState({ loading: false, data: null, error: res.data?.error || "This link is not valid" });
        }
      } catch (e) {
        setState({ loading: false, data: null, error: e.response?.data?.error || "This link is not valid" });
      }
    })();
  }, [token]);

  if (state.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-7 h-7 text-indigo-500 animate-spin" />
      </div>
    );
  }

  const expired = /expired/i.test(state.error);
  const revoked = /revoked/i.test(state.error);

  if (state.error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 text-center px-6">
        <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          {expired ? <Clock className="w-7 h-7 text-slate-400" /> : revoked ? <ShieldOff className="w-7 h-7 text-slate-400" /> : <FileX className="w-7 h-7 text-slate-400" />}
        </div>
        <h1 className="text-lg font-semibold text-slate-700">{expired ? "This link has expired" : revoked ? "Access revoked" : "Resource unavailable"}</h1>
        <p className="text-sm text-slate-500 mt-1.5 max-w-sm">{state.error}</p>
        <div className="mt-6 flex items-center gap-2 text-xs text-slate-400">
          <MascotBadge size={20} />
          <span>Powered by FunnelRoo</span>
        </div>
      </div>
    );
  }

  const d = state.data;
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
      <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
        <div className="w-14 h-14 rounded-2xl bg-indigo-100 flex items-center justify-center mx-auto mb-4">
          <Download className="w-7 h-7 text-indigo-600" />
        </div>
        <h1 className="text-lg font-semibold text-slate-800 mb-1">Your resource is ready</h1>
        <p className="text-sm text-slate-500 mb-5">{d.filename || "Resource"}</p>
        <a
          href={d.signed_url}
          download={d.filename || undefined}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
        >
          <Download className="w-4 h-4" /> Download
        </a>
        <p className="text-xs text-slate-400 mt-4">This download link expires shortly. Save the file to keep it.</p>
        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400">
          <MascotBadge size={20} />
          <span>Powered by FunnelRoo</span>
        </div>
      </div>
    </div>
  );
}