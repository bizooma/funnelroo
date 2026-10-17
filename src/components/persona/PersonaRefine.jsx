import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useWorkspace } from "@/lib/workspaceContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, X, AlertTriangle } from "lucide-react";
import { toast } from "@/components/ui/use-toast";

// Refine with Roo: returns structured editable suggestions with provenance,
// based ONLY on the selected audience revision. Apply is explicit per section.
export default function PersonaRefine({ open, audienceId, currentRevision, onClose, onApply }) {
  const { current } = useWorkspace();
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState(null);
  const [sourceRevision, setSourceRevision] = useState(null);
  const [error, setError] = useState(null);

  async function run() {
    if (!current || !audienceId) return;
    setLoading(true);
    setError(null);
    setDraft(null);
    try {
      const res = await base44.functions.invoke("rooAssist", {
        action: "refinePersona",
        workspace_id: current.id,
        audience_id: audienceId,
      });
      setDraft(res.data?.draft);
      setSourceRevision(res.data?.source_revision);
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Roo could not complete that right now.");
    } finally {
      setLoading(false);
    }
  }

  // If the audience changed while generating, the output is stale.
  const isStale = sourceRevision && currentRevision && sourceRevision !== currentRevision;

  function apply(field) {
    if (!draft?.[field]) return;
    onApply(field, draft[field]);
    toast({ title: "Applied — review and save" });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-indigo-600" /> Refine with Roo</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <p className="text-xs text-slate-500">
            Roo suggests content from your audience profile only. Nothing is applied automatically — review and apply each section. Suggestions are labeled “Suggested by Roo”.
          </p>
          {!draft && !error && (
            <Button onClick={run} disabled={loading || !current}>
              {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
              {loading ? "Roo is drafting…" : "Generate suggestions"}
            </Button>
          )}
          {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg p-3">{error}</div>}
          {isStale && (
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg p-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              The audience profile changed since this was generated. Review against the newer profile before applying.
            </div>
          )}
          {draft && (
            <div className="space-y-3">
              <Suggestion label="Archetype title" value={draft.archetype_title} onApply={() => apply("archetype_title")} field="title" />
              <Suggestion label="Bio summary" value={draft.bio_summary} multiline onApply={() => apply("bio_summary")} field="bio_summary" />
              <Suggestion label="Representative statement" value={draft.representative_statement} multiline onApply={() => apply("representative_statement")} field="quote" note="Applied as an illustrative statement — not a customer quote." />
              <Suggestion label="Motivation labels" value={(draft.motivation_labels || []).join(", ")} onApply={() => apply("motivation_labels")} field="motivations" />
              <Suggestion
                label="Messaging guidance"
                value={(draft.messaging_guidance || []).map((g) => `${g.heading ? `${g.heading}: ` : ""}${g.text}`).join("\n")}
                multiline
                onApply={() => {
                  if (!draft?.messaging_guidance?.length) return;
                  onApply("messaging", draft.messaging_guidance);
                  toast({ title: "Applied — review and save" });
                }}
                note="Stored on the card as team messaging guidance. Origin: Suggested by Roo."
              />
              {draft.notes && <div className="text-xs text-slate-400 italic">{draft.notes}</div>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Suggestion({ label, value, onApply, multiline, note }) {
  if (!value) return null;
  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className="text-[10px] uppercase bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded">Suggested by Roo</span>
      </div>
      {multiline ? (
        <p className="text-sm text-slate-700 mt-1.5 whitespace-pre-wrap">{value}</p>
      ) : (
        <p className="text-sm text-slate-700 mt-1.5">{value}</p>
      )}
      {note && <p className="text-[11px] text-slate-400 mt-1 italic">{note}</p>}
      <Button size="sm" variant="outline" className="mt-2" onClick={onApply}>Apply to card</Button>
    </div>
  );
}