import React, { useState } from "react";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { Plus, Check, Loader2, ChevronDown, Info } from "lucide-react";

// Inline asset selector for the funnel editor's Plan tab.
// Replaces "Define audiences in Settings" with inline selection + creation.
// Supports audiences and offers. Saving creates/updates the workspace asset,
// selects it in the current draft, and returns to the original task.
// Canceling leaves current selections intact.
export default function AssetSelector({ kind, items, value, onChange, canAdmin }) {
  const { current } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [showInfo, setShowInfo] = useState(false);

  const selected = items.find((i) => i.id === value);
  const label = kind === "audience" ? "audience" : "offer";
  const action = kind === "audience" ? "saveAudience" : "saveOffer";

  async function create() {
    setCreating(true);
    try {
      const payload = {
        action,
        workspace_id: current.id,
        name: form.name,
        status: "draft",
      };
      if (kind === "audience") {
        payload.roles_industries = form.description;
      } else {
        payload.offer = form.description;
        payload.goal = "lead_magnet";
      }
      const res = await base44.functions.invoke("marketingKitAccess", payload);
      const asset = res.data?.[kind === "audience" ? "audience" : "offer"];
      if (asset) {
        onChange(asset.id);
        toast({ title: `${label.charAt(0).toUpperCase() + label.slice(1)} created as draft` });
        setOpen(false);
        setForm({ name: "", description: "" });
      }
    } catch (e) {
      toast({ title: "Creation failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <Label className="text-xs text-slate-500">
        {kind === "audience" ? "Who is this funnel for?" : "What are you promoting?"}
      </Label>
      <p className="text-xs text-slate-400 mt-0.5 mb-1.5">
        {kind === "audience"
          ? "Choose a saved audience or create one here. Roo will use it to tailor your message."
          : "Choose a saved offer or create one here."}
      </p>
      <div className="flex items-center gap-2">
        <select
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
        >
          <option value="">— none —</option>
          {items.filter((i) => i.status !== "archived").map((i) => (
            <option key={i.id} value={i.id}>{i.name}{i.status === "ready" ? " · Ready" : " · Draft"}</option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Create {label}
        </Button>
      </div>
      {selected && (
        <button onClick={() => setShowInfo(!showInfo)} className="text-xs text-indigo-600 hover:text-indigo-700 mt-1.5 flex items-center gap-1">
          <Info className="w-3 h-3" />
          {selected.status === "ready" ? "Ready to use" : "Draft"} · {selected.funnel_count > 1 ? `Used by ${selected.funnel_count} funnels — editing affects all` : "Reusable across funnels"}
          <ChevronDown className="w-3 h-3" />
        </button>
      )}
      {showInfo && selected && (
        <div className="mt-1.5 rounded-lg bg-slate-50 border border-slate-100 p-2.5 text-xs text-slate-500">
          This {label} is reusable. Editing it here updates it for all funnels that use it. To make a funnel-specific variant, duplicate it from the Marketing kit first.
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create {label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs text-slate-500">{kind === "audience" ? "Profile name" : "Offer name"}</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="mt-1.5" placeholder={kind === "audience" ? "e.g. Growing business owners" : "e.g. Onboarding consulting"} />
            </div>
            <div>
              <Label className="text-xs text-slate-500">{kind === "audience" ? "Who is the customer?" : "Brief description"}</Label>
              <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className="mt-1.5" placeholder={kind === "audience" ? "Roles, industries, problems" : "What is it?"} />
            </div>
            <p className="text-xs text-slate-400">This creates a draft. You can add more detail and mark it ready in the Marketing kit.</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!form.name?.trim() || creating} onClick={create}>
              {creating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
              {creating ? "Creating…" : "Create & select"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}