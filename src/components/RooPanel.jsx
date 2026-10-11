import React, { useState } from "react";
import { Sparkles, Loader2, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { MascotBadge } from "@/components/MascotBadge";
import { useWorkspace } from "@/lib/workspaceContext";

// Contextual Roo assistant panel. Drafts content from the approved brief.
export function RooPanel({ title = "Ask Roo", context, onApply, action, extraPayload }) {
  const { current } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function run() {
    if (!current) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await base44.functions.invoke("rooAssist", {
        action,
        workspace_id: current.id,
        context,
        ...extraPayload,
      });
      setResult(res.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Roo could not complete that right now. You can edit manually.");
    } finally {
      setLoading(false);
      setOpen(true);
    }
  }

  return (
    <>
      <button
        onClick={run}
        disabled={loading || !current}
        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {loading ? "Roo is drafting…" : title}
      </button>

      {open && (result || error) && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 p-5 border-b border-slate-100">
              <MascotBadge size={40} src={current?.mascot_image_url} />
              <div className="flex-1">
                <div className="font-semibold text-slate-900">Roo's draft</div>
                <div className="text-xs text-slate-400">AI suggestion — review and approve before publishing</div>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5">
              {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg p-3">{error}</div>}
              {result?.draft && (
                <DraftView draft={result.draft} onApply={() => { onApply?.(result.draft); setOpen(false); }} />
              )}
              {result?.suggestion && (
                <div className="space-y-2">
                  <div className="font-medium text-slate-800">{result.suggestion.next_step}</div>
                  <p className="text-sm text-slate-500">{result.suggestion.why}</p>
                  {result.suggestion.evidence && <p className="text-xs text-slate-400 italic">{result.suggestion.evidence}</p>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DraftView({ draft, onApply }) {
  return (
    <div className="space-y-3">
      <pre className="text-xs bg-slate-50 rounded-lg p-3 overflow-x-auto text-slate-700 whitespace-pre-wrap">{JSON.stringify(draft, null, 2)}</pre>
      <div className="flex justify-end gap-2">
        <button onClick={onApply} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
          Apply draft
        </button>
      </div>
    </div>
  );
}