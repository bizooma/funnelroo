import React, { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import { RooPanel } from "@/components/RooPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import {
  Plus, Search, Loader2, Save, Copy, Archive, RotateCcw, Check, ChevronDown, ChevronUp,
} from "lucide-react";

const GOAL_LABELS = {
  lead_magnet: "Request a free resource",
  direct_booking: "Book a demo or consultation",
  service_inquiry: "Send an inquiry",
};

export default function OfferManager() {
  const { current, canAdmin } = useWorkspace();
  const [offers, setOffers] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  async function load() {
    if (!current) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke("marketingKitAccess", { action: "listOffers", workspace_id: current.id });
      setOffers(res.data?.offers || []);
    } catch (e) {
      toast({ title: "Load failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [current]);

  const filtered = offers.filter((o) => o.name.toLowerCase().includes(query.toLowerCase()));

  async function duplicate(o) {
    try {
      await base44.functions.invoke("marketingKitAccess", { action: "duplicateOffer", workspace_id: current.id, id: o.id });
      toast({ title: "Duplicated as draft" });
      load();
    } catch (e) {
      toast({ title: "Failed", variant: "destructive" });
    }
  }

  async function archive(o) {
    try {
      await base44.functions.invoke("marketingKitAccess", { action: "archiveOffer", workspace_id: current.id, id: o.id });
      toast({ title: "Archived" });
      load();
    } catch (e) {
      toast({ title: "Failed", variant: "destructive" });
    }
  }

  async function restore(o) {
    try {
      await base44.functions.invoke("marketingKitAccess", { action: "restoreOffer", workspace_id: current.id, id: o.id });
      toast({ title: "Restored" });
      load();
    } catch (e) {
      toast({ title: "Failed", variant: "destructive" });
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-slate-500 max-w-md">
          An offer is the product or service you promote. One offer can support several audiences, resources, and funnel types.
        </p>
        <Button size="sm" onClick={() => setEditing({ name: "", offer: "", goal: "lead_magnet", cta: "", benefit: "", deliverable: "", pricing: "", differentiators: [], exclusions: [], supporting_proof: [], status: "draft" })}>
          <Plus className="w-3.5 h-3.5 mr-1" /> New offer
        </Button>
      </div>

      <div className="relative mb-4 max-w-xs">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search offers" className="pl-9" />
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-slate-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-slate-200 rounded-xl p-8 text-center">
          <p className="text-sm text-slate-500">{offers.length === 0 ? "No offers yet. Create one to get started." : "No matches."}</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((o) => (
            <OfferRow key={o.id} offer={o} onEdit={() => setEditing(o)} onDuplicate={() => duplicate(o)} onArchive={() => archive(o)} onRestore={() => restore(o)} />
          ))}
        </div>
      )}

      {editing && (
        <OfferEditor offer={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function OfferRow({ offer, onEdit, onDuplicate, onArchive, onRestore }) {
  const [expanded, setExpanded] = useState(false);
  const statusMap = { draft: "bg-slate-100 text-slate-600", ready: "bg-emerald-100 text-emerald-700", archived: "bg-slate-100 text-slate-400" };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex-1 cursor-pointer" onClick={onEdit}>
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-800">{offer.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full capitalize ${statusMap[offer.status] || statusMap.draft}`}>{offer.status}</span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {GOAL_LABELS[offer.goal] || offer.goal || "—"} · Used by {offer.funnel_count || 0} funnel{offer.funnel_count === 1 ? "" : "s"}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={onDuplicate} title="Duplicate as draft"><Copy className="w-3.5 h-3.5" /></Button>
            {offer.status === "archived" ? (
              <Button size="sm" variant="ghost" onClick={onRestore} title="Restore"><RotateCcw className="w-3.5 h-3.5" /></Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={onArchive} title="Archive"><Archive className="w-3.5 h-3.5" /></Button>
            )}
          </div>
        </div>
        {expanded && (
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5 text-sm">
            {offer.offer && <div><span className="text-xs font-medium text-slate-500">Description: </span><span className="text-slate-600">{offer.offer}</span></div>}
            {offer.benefit && <div><span className="text-xs font-medium text-slate-500">Benefit: </span><span className="text-slate-600">{offer.benefit}</span></div>}
            {offer.deliverable && <div><span className="text-xs font-medium text-slate-500">What they receive: </span><span className="text-slate-600">{offer.deliverable}</span></div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OfferEditor({ offer, onClose, onSaved }) {
  const { current, canAdmin } = useWorkspace();
  const [form, setForm] = useState(offer);
  const [saving, setSaving] = useState(false);
  const [showOptional, setShowOptional] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setArr = (k, text) => set(k, text.split("\n").filter(Boolean));

  async function save(status) {
    setSaving(true);
    try {
      const res = await base44.functions.invoke("marketingKitAccess", {
        action: "saveOffer",
        workspace_id: current.id,
        id: form.id,
        name: form.name,
        offer: form.offer,
        goal: form.goal,
        cta: form.cta,
        benefit: form.benefit,
        deliverable: form.deliverable,
        pricing: form.pricing,
        differentiators: form.differentiators || [],
        exclusions: form.exclusions || [],
        supporting_proof: form.supporting_proof || [],
        status: status || form.status || "draft",
      });
      toast({ title: status === "ready" ? "Marked ready" : "Saved" });
      onSaved(res.data?.offer);
    } catch (e) {
      toast({ title: "Save failed", description: e.response?.data?.error || e.message, variant: "destructive" });
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit offer" : "New offer"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Field label="Offer name"><Input value={form.name || ""} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Employee onboarding consulting" /></Field>
          <Field label="Product or service description"><Textarea value={form.offer || ""} onChange={(e) => set("offer", e.target.value)} rows={2} placeholder="What is it?" /></Field>
          <Field label="Main benefit or intended outcome"><Textarea value={form.benefit || ""} onChange={(e) => set("benefit", e.target.value)} rows={2} placeholder="What result does the customer get?" /></Field>
          <Field label="What the customer receives"><Textarea value={form.deliverable || ""} onChange={(e) => set("deliverable", e.target.value)} rows={2} placeholder="What do they actually get?" /></Field>
          <Field label="Suggested funnel goal">
            <select value={form.goal || "lead_magnet"} onChange={(e) => set("goal", e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white">
              <option value="lead_magnet">Request a free resource</option>
              <option value="direct_booking">Book a demo or consultation</option>
              <option value="service_inquiry">Send an inquiry</option>
            </select>
          </Field>

          <button onClick={() => setShowOptional(!showOptional)} className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
            {showOptional ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Add more detail
          </button>
          {showOptional && (
            <div className="space-y-4 pt-2 border-t border-slate-100">
              <Field label="Price or pricing approach"><Input value={form.pricing || ""} onChange={(e) => set("pricing", e.target.value)} placeholder="e.g. $500/mo, custom quote" /></Field>
              <Field label="Differentiators (one per line)"><Textarea value={(form.differentiators || []).join("\n")} onChange={(e) => setArr("differentiators", e.target.value)} rows={2} /></Field>
              <Field label="Exclusions (one per line)"><Textarea value={(form.exclusions || []).join("\n")} onChange={(e) => setArr("exclusions", e.target.value)} rows={2} /></Field>
              <Field label="Approved supporting evidence (one per line)"><Textarea value={(form.supporting_proof || []).join("\n")} onChange={(e) => setArr("supporting_proof", e.target.value)} rows={2} placeholder="Only proof you can stand behind" /></Field>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <RooPanel
              title="Help clarify my offer"
              action="draftOffer"
              extraPayload={{ goal: form.goal }}
              onApply={(d) => {
                if (d.name) setForm((f) => ({
                  ...f,
                  name: d.name,
                  offer: d.offer || f.offer,
                  goal: d.goal || f.goal,
                  cta: d.cta || f.cta,
                  supporting_proof: d.supporting_proof || f.supporting_proof,
                }));
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="outline" disabled={!form.name?.trim() || saving} onClick={() => save("draft")}>
            <Save className="w-3.5 h-3.5 mr-1.5" /> Save draft
          </Button>
          {canAdmin && (
            <Button disabled={!form.name?.trim() || saving} onClick={() => save("ready")}>
              <Check className="w-3.5 h-3.5 mr-1.5" /> {saving ? "Saving…" : "Mark ready"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <Label className="text-xs text-slate-500">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}