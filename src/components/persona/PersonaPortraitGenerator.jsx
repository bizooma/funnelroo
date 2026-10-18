import React, { useState, useEffect, useRef } from "react";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, Sparkles, RefreshCw, Check, ChevronDown, ChevronUp, AlertTriangle,
} from "lucide-react";
import { toast } from "@/components/ui/use-toast";

const POLL_MS = 3000;
const CAPTION = "AI-generated illustration of this audience — not a real customer.";

// PersonaPortraitGenerator: explicit-only AI portrait generation.
// Nothing generates on open, save, review, export or reload. The current
// portrait is never replaced unless the user clicks "Use this image".
// onApplied(fields, alreadySaved) — for AI apply the backend has already
// persisted; the parent only needs to merge the fields into local state.
export default function PersonaPortraitGenerator({ open, audienceId, audienceRevision, onClose, onApplied }) {
  const { current } = useWorkspace();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [prefs, setPrefs] = useState({ style: "photo", background: "workplace", appearance: "" });
  const [showAdjust, setShowAdjust] = useState(false);
  const pollRef = useRef(null);

  async function fetchStatus() {
    if (!current || !audienceId) return;
    try {
      const res = await base44.functions.invoke("marketingKitAccess", {
        action: "getPersonaPortrait",
        workspace_id: current.id,
        id: audienceId,
      });
      setRequest(res.data?.request || null);
      const vp = res.data?.request?.visual_preferences;
      if (vp) setPrefs(() => ({ style: "photo", background: "workplace", appearance: "", ...vp }));
    } catch {
      /* ignore — recoverable on next poll */
    }
  }

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setRequest(null);
    fetchStatus().finally(() => setLoading(false));
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [open, audienceId, current?.id]);

  // Poll while a request is pending (reconnect / in-flight recovery).
  useEffect(() => {
    if (!open || !request || request.state !== "pending") return;
    const tick = async () => {
      await fetchStatus();
      pollRef.current = setTimeout(tick, POLL_MS);
    };
    pollRef.current = setTimeout(tick, POLL_MS);
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [open, request?.state, request?.id]);

  async function generate() {
    if (!current || !audienceId) return;
    setGenerating(true);
    try {
      const res = await base44.functions.invoke("marketingKitAccess", {
        action: "generatePersonaPortrait",
        workspace_id: current.id,
        id: audienceId,
        visual_preferences: prefs,
        mode: "new",
      });
      setRequest(res.data?.request || null);
    } catch (e) {
      toast({
        title: "Generation failed",
        description: e.response?.data?.error || "Roo couldn't create the image. Your current portrait was kept.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }

  async function useImage() {
    if (!request?.candidate_url || !request?.request_id) return;
    try {
      const res = await base44.functions.invoke("marketingKitAccess", {
        action: "applyPersonaPortrait",
        workspace_id: current.id,
        id: audienceId,
        request_id: request.request_id,
      });
      const p = res.data?.audience?.persona;
      if (p && onApplied) {
        onApplied(
          {
            portrait_url: p.portrait_url,
            portrait_credit: p.portrait_credit,
            portrait_origin: p.portrait_origin,
            portrait_alt: p.portrait_alt,
            portrait_applied_at: p.portrait_applied_at,
          },
          true,
        );
      }
      toast({ title: "Portrait saved" });
      onClose();
    } catch (e) {
      toast({ title: "Save failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    }
  }

  const pending = generating || request?.state === "pending";
  const ready = request?.state === "ready" && request?.candidate_url;
  const failed = request?.state === "failed";
  const audienceChanged =
    ready &&
    request.source_audience_revision &&
    audienceRevision &&
    request.source_audience_revision !== audienceRevision;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Persona portrait</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mx-auto" />
          </div>
        ) : pending ? (
          <div className="py-8 text-center">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-600" />
            <p className="mt-3 text-sm text-slate-600">Roo is creating your persona image…</p>
          </div>
        ) : ready ? (
          <div className="space-y-3">
            <div className="relative w-full overflow-hidden rounded-lg border border-slate-200" style={{ aspectRatio: "4 / 3" }}>
              <img src={request.candidate_url} alt="AI-generated persona portrait preview" className="w-full h-full object-cover" />
            </div>
            <p className="text-xs text-slate-500 italic">{CAPTION}</p>
            {audienceChanged && (
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded p-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>This portrait was generated from an earlier version of this audience. You can still use it, or generate another to match the updated profile.</span>
              </div>
            )}
          </div>
        ) : failed ? (
          <div className="py-6 text-center">
            <p className="text-sm text-slate-600">Roo couldn't create the image. Your current portrait was kept.</p>
            {request?.error && <p className="text-xs text-slate-400 mt-1">{request.error}</p>}
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-800">Give this persona a face.</p>
            <p className="text-xs text-slate-500">Roo can create an illustrative portrait using your audience's role and context. It represents your audience — not a real customer.</p>
          </div>
        )}

        {!pending && (
          <div className="pt-2 border-t border-slate-100">
            <button onClick={() => setShowAdjust((v) => !v)} className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
              {showAdjust ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Adjust image
            </button>
            {showAdjust && (
              <div className="space-y-3 mt-2">
                <div>
                  <Label className="text-xs text-slate-500">Style</Label>
                  <select
                    value={prefs.style}
                    onChange={(e) => setPrefs((p) => ({ ...p, style: e.target.value }))}
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm mt-1"
                  >
                    <option value="photo">Realistic photo</option>
                    <option value="illustration">Illustration</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Background</Label>
                  <select
                    value={prefs.background}
                    onChange={(e) => setPrefs((p) => ({ ...p, background: e.target.value }))}
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm mt-1"
                  >
                    <option value="workplace">Workplace (fits the role)</option>
                    <option value="studio">Neutral studio</option>
                    <option value="neutral">Plain background</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Appearance details (optional)</Label>
                  <Textarea
                    value={prefs.appearance}
                    onChange={(e) => setPrefs((p) => ({ ...p, appearance: e.target.value }))}
                    rows={2}
                    placeholder="e.g. glasses, casual jacket — leave blank to avoid implying a specific demographic"
                    className="mt-1"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">These are creative choices. Roo won't infer identity from your audience's name or problem.</p>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2 sm:flex-nowrap">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <div className="flex-1" />
          {ready ? (
            <>
              <Button variant="outline" onClick={generate} disabled={pending}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Generate another
              </Button>
              <Button onClick={useImage}><Check className="w-3.5 h-3.5 mr-1.5" /> Use this image</Button>
            </>
          ) : failed ? (
            <Button onClick={generate} disabled={pending}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Try again
            </Button>
          ) : (
            <Button onClick={generate} disabled={pending}>
              {pending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />} Generate with Roo
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}