import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, X, Sparkles } from "lucide-react";
import { THEME_PRESETS } from "./buildCardData";
import PersonaPortraitGenerator from "./PersonaPortraitGenerator";

// Compact customization panel for persona presentation metadata.
// Core facts remain bound to the Audience editor — this edits only the
// `persona` presentation object.
export default function PersonaCustomize({ open, persona, onClose, onSave, audienceId }) {
  const [form, setForm] = useState(persona || {});
  const [saving, setSaving] = useState(false);
  const [portraitGen, setPortraitGen] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // AI portrait apply already persisted server-side; reflect it in the form so
  // the user sees the change. Saving the card re-persists consistently.
  function handlePortraitApplied(fields) {
    setForm((f) => ({ ...f, ...fields }));
  }

  function setMotivation(i, key, val) {
    setForm((f) => {
      const arr = [...(f.motivations || [])];
      arr[i] = { ...arr[i], [key]: val };
      return { ...f, motivations: arr };
    });
  }
  function addMotivation() {
    setForm((f) => ({ ...f, motivations: [...(f.motivations || []), { label: "", rating: null }] }));
  }
  function removeMotivation(i) {
    setForm((f) => ({ ...f, motivations: (f.motivations || []).filter((_, idx) => idx !== i) }));
  }
  function setBuying(i, key, val) {
    setForm((f) => {
      const arr = [...(f.buying_style || [])];
      arr[i] = { ...arr[i], [key]: val };
      return { ...f, buying_style: arr };
    });
  }
  function addBuying() {
    setForm((f) => ({ ...f, buying_style: [...(f.buying_style || []), { left: "", right: "", position: 50 }] }));
  }
  function removeBuying(i) {
    setForm((f) => ({ ...f, buying_style: (f.buying_style || []).filter((_, idx) => idx !== i) }));
  }
  function setMessaging(i, key, val) {
    setForm((f) => {
      const arr = [...(f.messaging_guidance || [])];
      arr[i] = { ...arr[i], [key]: val };
      return { ...f, messaging_guidance: arr };
    });
  }
  function addMessaging() {
    setForm((f) => ({ ...f, messaging_guidance: [...(f.messaging_guidance || []), { heading: "", text: "" }] }));
  }
  function removeMessaging(i) {
    setForm((f) => ({ ...f, messaging_guidance: (f.messaging_guidance || []).filter((_, idx) => idx !== i) }));
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Customize persona card</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Row label="Card title">
            <Input value={form.title || ""} onChange={(e) => set("title", e.target.value)} placeholder="e.g. The Hands-On Agency Owner" />
          </Row>
          <Row label="Subtitle (archetype)">
            <Input value={form.subtitle || ""} onChange={(e) => set("subtitle", e.target.value)} placeholder="Short descriptor" />
          </Row>

          <div className="pt-2 border-t border-slate-100">
            <Label className="text-xs text-slate-500">Optional facts</Label>
            <div className="grid grid-cols-2 gap-3 mt-1.5">
              <Row label="Role"><Input value={form.role || ""} onChange={(e) => set("role", e.target.value)} /></Row>
              <Row label="Industry"><Input value={form.industry || ""} onChange={(e) => set("industry", e.target.value)} /></Row>
              <Row label="Company size"><Input value={form.company_size || ""} onChange={(e) => set("company_size", e.target.value)} /></Row>
              <Row label="Location"><Input value={form.location || ""} onChange={(e) => set("location", e.target.value)} /></Row>
              <Row label="Buying role"><Input value={form.buying_role || ""} onChange={(e) => set("buying_role", e.target.value)} /></Row>
              <Row label="Age (optional)"><Input value={form.age || ""} onChange={(e) => set("age", e.target.value)} /></Row>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <Row label="Portrait image URL">
              <Input value={form.portrait_url || ""} onChange={(e) => set("portrait_url", e.target.value)} placeholder="https://…" />
            </Row>
            <div className="mt-1.5">
              <Button size="sm" variant="outline" onClick={() => setPortraitGen(true)} disabled={!audienceId}>
                <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Generate with Roo
              </Button>
              <p className="text-[11px] text-slate-400 mt-1">Roo creates an illustrative portrait from this audience's role and context — no photo or prompt needed.</p>
            </div>
            <Row label="Image credit / source">
              <Input value={form.portrait_credit || ""} onChange={(e) => set("portrait_credit", e.target.value)} />
            </Row>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <Row label="Quote / statement">
              <Textarea value={form.quote_text || ""} onChange={(e) => set("quote_text", e.target.value)} rows={2} />
            </Row>
            <Row label="Quote source note">
              <Input value={form.quote_source || ""} onChange={(e) => set("quote_source", e.target.value)} placeholder="e.g. Customer interview, 2025" />
            </Row>
            <Row label="Quote type">
              <select value={form.quote_kind || ""} onChange={(e) => set("quote_kind", e.target.value)} className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="">None</option>
                <option value="customer">Customer quote</option>
                <option value="representative">Representative statement</option>
                <option value="illustrative">Illustrative statement (Roo)</option>
              </select>
            </Row>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <Row label="Bio summary">
              <Textarea value={form.bio_summary || ""} onChange={(e) => set("bio_summary", e.target.value)} rows={3} placeholder="2-3 sentence factual summary from the audience profile" />
            </Row>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-slate-500">Purchasing motivations (up to 6)</Label>
              <Button size="sm" variant="ghost" onClick={addMotivation}><Plus className="w-3.5 h-3.5" /></Button>
            </div>
            <div className="space-y-2 mt-1.5">
              {(form.motivations || []).map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={m.label || ""} onChange={(e) => setMotivation(i, "label", e.target.value)} placeholder="Motivation label" className="flex-1" />
                  <select value={m.rating ?? ""} onChange={(e) => setMotivation(i, "rating", e.target.value ? Number(e.target.value) : null)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm w-28">
                    <option value="">Not rated</option>
                    <option value="1">1 — Lower</option>
                    <option value="2">2</option>
                    <option value="3">3 — Moderate</option>
                    <option value="4">4</option>
                    <option value="5">5 — Higher</option>
                  </select>
                  <Button size="sm" variant="ghost" onClick={() => removeMotivation(i)}><X className="w-3.5 h-3.5" /></Button>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-slate-500">Buying style scales (optional)</Label>
              <Button size="sm" variant="ghost" onClick={addBuying}><Plus className="w-3.5 h-3.5" /></Button>
            </div>
            <div className="space-y-2 mt-1.5">
              {(form.buying_style || []).map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={b.left || ""} onChange={(e) => setBuying(i, "left", e.target.value)} placeholder="Left pole" className="flex-1" />
                  <input type="range" min="0" max="100" value={b.position ?? 50} onChange={(e) => setBuying(i, "position", Number(e.target.value))} className="flex-1" />
                  <Input value={b.right || ""} onChange={(e) => setBuying(i, "right", e.target.value)} placeholder="Right pole" className="flex-1" />
                  <Button size="sm" variant="ghost" onClick={() => removeBuying(i)}><X className="w-3.5 h-3.5" /></Button>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-slate-500">Messaging guidance (optional)</Label>
              <Button size="sm" variant="ghost" onClick={addMessaging}><Plus className="w-3.5 h-3.5" /></Button>
            </div>
            <div className="space-y-2 mt-1.5">
              {(form.messaging_guidance || []).map((g, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Input value={g.heading || ""} onChange={(e) => setMessaging(i, "heading", e.target.value)} placeholder="Heading" className="w-36" />
                  <Textarea value={g.text || ""} onChange={(e) => setMessaging(i, "text", e.target.value)} rows={2} placeholder="Guidance note" className="flex-1" />
                  <Button size="sm" variant="ghost" onClick={() => removeMessaging(i)}><X className="w-3.5 h-3.5" /></Button>
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2 mt-2 text-xs text-slate-500">
              <input type="checkbox" checked={!!form.messaging_ai_suggested} onChange={(e) => set("messaging_ai_suggested", e.target.checked)} />
              Marked as Roo-suggested origin
            </label>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <Label className="text-xs text-slate-500">Theme</Label>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {THEME_PRESETS.map((t) => (
                <button key={t.id} onClick={() => set("theme", { accent: t.accent, preset: t.id })} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${form.theme?.preset === t.id ? "border-slate-900 bg-slate-50" : "border-slate-200"}`}>
                  <span className="w-4 h-4 rounded" style={{ background: t.accent }} /> {t.label}
                </button>
              ))}
            </div>
            <Row label="Custom accent">
              <Input value={form.theme?.accent || ""} onChange={(e) => set("theme", { ...form.theme, accent: e.target.value, preset: "custom" })} placeholder="#FFB800" />
            </Row>
          </div>

          <label className="flex items-center gap-2 pt-2 text-sm text-slate-600">
            <input type="checkbox" checked={!!form.highlights_only} onChange={(e) => set("highlights_only", e.target.checked)} />
            Selected highlights (card does not contain all source material)
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={save}>
            {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />} {saving ? "Saving…" : "Save card"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {portraitGen && audienceId && (
        <PersonaPortraitGenerator
          open={portraitGen}
          audienceId={audienceId}
          audienceRevision={null}
          onClose={() => setPortraitGen(false)}
          onApplied={handlePortraitApplied}
        />
      )}
    </Dialog>
  );
}

function Row({ label, children }) {
  return (
    <div className="mt-2">
      <Label className="text-xs text-slate-500">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}