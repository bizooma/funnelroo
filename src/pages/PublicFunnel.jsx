import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { PageRenderer } from "@/components/funnel/PageRenderer";
import { MascotBadge } from "@/components/MascotBadge";
import { Loader2, FileQuestion } from "lucide-react";

// Anonymous public funnel page. No auth required.
// Reads only the approved published snapshot — never drafts or contacts.
export default function PublicFunnel() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await base44.functions.invoke("getPublishedFunnel", { slug });
        if (res.status === 200) {
          setData(res.data);
        } else {
          setError(res.data?.error || "Funnel not available");
        }
      } catch (e) {
        setError(e.response?.data?.error || "Funnel not found or not published");
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-7 h-7 text-indigo-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 text-center px-6">
        <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <FileQuestion className="w-7 h-7 text-slate-400" />
        </div>
        <h1 className="text-lg font-semibold text-slate-700">This funnel isn't available</h1>
        <p className="text-sm text-slate-500 mt-1.5 max-w-sm">{error}. It may be unpublished, paused, or the link may be incorrect.</p>
        <div className="mt-6 flex items-center gap-2 text-xs text-slate-400">
          <MascotBadge size={24} />
          <span>Powered by FunnelRoo</span>
        </div>
      </div>
    );
  }

  const snapshot = data?.version?.snapshot || {};
  const blocks = snapshot.page_blocks || [];
  const theme = snapshot.theme || {};

  return (
    <div className="min-h-screen bg-white">
      <PageRenderer blocks={blocks} theme={theme} mode="public" />
      <div className="py-6 text-center">
        <div className="inline-flex items-center gap-2 text-xs text-slate-300">
          <MascotBadge size={20} />
          <span>Powered by FunnelRoo</span>
        </div>
      </div>
    </div>
  );
}