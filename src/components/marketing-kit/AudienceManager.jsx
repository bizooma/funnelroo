import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  Plus, Search, Loader2, Save, Copy, Archive, RotateCcw, Check, ChevronDown, ChevronUp, Sparkles, Eye, Pencil,
} from "lucide-react";

export default function AudienceManager() {
  const { current, canAdmin } = useWorkspace();
  const [audiences, setAudiences] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // audience being edited or "new"

  async function load() {
    if (!current) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke("marketingKitAccess", { action: "listAudiences", workspace_id: current.id });
      setAudiences(res.data?.audiences || []);
    } catch (e) {
      toast({ title: "Load failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [current]);

  const filtered = audiences.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));

  async function duplicate(a) {
    try {
      await base44.functions.invoke("marketingKitAccess", { action: "duplicateAudience", workspace_id: current.id, id: a.id });
      toast({ title: "Duplicated as draft" });
      load();
    } catch (e) {
      toast({ title: "Failed", variant: "destructive" });
    }
  }

  async function archive(a) {
    try {
      await base44.functions.invoke("marketingKitAccess", { action: "archiveAudience", workspace_id: current.id, id: a.id });
      toast({ title: "Archived" });
      load();
    } catch (e) {
      toast({ title: "Failed", variant: "destructive" });
    }
  }

  async function restore(a) {
    try {
      await base44.functions.invoke("marketingKitAccess", { action: "restoreAudience", workspace_id: current.id, id: a.id });
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
          An audience profile describes your ideal customer. Roo uses it to tailor your message. It does not import contacts or create an advertising audience.
        </p>
        <Button size="sm" onClick={() => setEditing({ name: "", roles_industries: "", problems: [], desired_outcomes: [], objections: [], alternatives: [], status: "draft" })}>
          <Plus className="w-3.5 h-3.5 mr-1" /> New audience
        </Button>
      </div>

      <div className="relative mb-4 max-w-xs">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search audiences" className="pl-9" />
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-slate-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-slate-200 rounded-xl p-8 text-center">
          <p className="text-sm text-slate-500">{audiences.length === 0 ? "No audiences yet. Create one to get started." : "No matches."}</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((a) => (
            <AudienceRow key={a.id} audience={a} canAdmin={canAdmin} onEdit={() => setEditing(a)} onDuplicate={() => duplicate(a)} onArchive={() => archive(a)} onRestore={() => restore(a)} />
          ))}
        </div>
      )}

      {editing && (
        <AudienceEditor audience={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function AudienceRow({ audience, canAdmin, onEdit, onDuplicate, onArchive, onRestore }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const statusMap = { draft: "bg-slate-100 text-slate-600", ready: "bg-emerald-100 text-emerald-700", archived: "bg-slate-100 text-slate-400" };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex-1 cursor-pointer" onClick={() => navigate(`/marketing-kit/audiences/${audience.id}`)}>
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-800">{audience.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full capitalize ${statusMap[audience.status] || statusMap.draft}`}>{audience.status}</span>
              {audience.ai_suggested && <span className="text-[10px] uppercase bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded">AI suggestion</span>}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {audience.roles_industries || "No description"} · Used by {audience.funnel_count || 0} funnel{audience.funnel_count === 1 ? "" : "s"}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={onEdit} title="Edit audience"><Pencil className="w-3.5 h-3.5" /></Button>
            <Link to={`/marketing-kit/audiences/${audience.id}`}>
              <Button size="sm" variant="ghost" title="View persona card"><Eye className="w-3.5 h-3.5" /></Button>
            </Link>
            <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={onDuplicate} title="Duplicate as draft"><Copy className="w-3.5 h-3.5" /></Button>
            {audience.status === "archived" ? (
              <Button size="sm" variant="ghost" onClick={onRestore} title="Restore"><RotateCcw className="w-3.5 h-3.5" /></Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={onArchive} title="Archive"><Archive className="w-3.5 h-3.5" /></Button>
            )}
          </div>
        </div>
        {expanded && (
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-2 text-sm">
            {audience.problems?.length > 0 && <Detail label="Problems" items={audience.problems} />}
            {audience.desired_outcomes?.length > 0 && <Detail label="Desired outcomes" items={audience.desired_outcomes} />}
            {audience.objections?.length > 0 && <Detail label="Objections" items={audience.objections} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Detail({ label, items }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <ul className="text-xs text-slate-600 mt-0.5 list-disc list-inside">
        {items.map((p, i) => <li key={i}>{p}</li>)}
      </ul>
    </div>
  );
}

export function AudienceEditor({ audience, onClose, onSaved }) {
  const { current, canAdmin } = useWorkspace();
  const [form, setForm] = useState(audience);
  const [saving, setSaving] = useState(false);
  const [showOptional, setShowOptional] = useState(false);
  const [justSaved, setJustSaved] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  // Keep blank lines while editing so Enter works; empty lines are stripped at save.
  const setArr = (k, text) => set(k, text.split("\n"));

  async function save(status) {
    setSaving(true);
    try {
      const res = await base44.functions.invoke("marketingKitAccess", {
        action: "saveAudience",
        workspace_id: current.id,
        id: form.id,
        name: form.name,
        roles_industries: form.roles_industries,
        problems: (form.problems || []).filter(Boolean),
        desired_outcomes: (form.desired_outcomes || []).filter(Boolean),
        objections: (form.objections || []).filter(Boolean),
        alternatives: (form.alternatives || []).filter(Boolean),
        status: status || form.status || "draft",
      });
      toast({ title: status === "ready" ? "Marked ready" : "Saved" });
      setJustSaved(res.data?.audience || form);
    } catch (e) {
      toast({ title: "Save failed", description: e.response?.data?.error || e.message, variant: "destructive" });
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit audience" : "New audience"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Field label="Profile name"><Input value={form.name || ""} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Growing business owners" /></Field>
          <Field label="Who is the customer?"><Textarea value={form.roles_industries || ""} onChange={(e) => set("roles_industries", e.target.value)} rows={2} placeholder="Roles, industries, company type" /></Field>
          <Field label="Main problem or need (one per line)"><Textarea value={(form.problems || []).join("\n")} onChange={(e) => setArr("problems", e.target.value)} rows={3} placeholder="What problem do they have?" /></Field>
          <Field label="Desired outcome (one per line)"><Textarea value={(form.desired_outcomes || []).join("\n")} onChange={(e) => setArr("desired_outcomes", e.target.value)} rows={2} placeholder="What do they want to achieve?" /></Field>

          <button onClick={() => setShowOptional(!showOptional)} className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
            {showOptional ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Add more detail
          </button>
          {showOptional && (
            <div className="space-y-4 pt-2 border-t border-slate-100">
              <Field label="Objections (one per line)"><Textarea value={(form.objections || []).join("\n")} onChange={(e) => setArr("objections", e.target.value)} rows={2} /></Field>
              <Field label="Existing solutions they use (one per line)"><Textarea value={(form.alternatives || []).join("\n")} onChange={(e) => setArr("alternatives", e.target.value)} rows={2} /></Field>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <RooPanel
              title="Help me define my audience"
              action="draftAudience"
              onApply={(d) => {
                if (d.name) setForm((f) => ({
                  ...f,
                  name: d.name,
                  roles_industries: d.roles_industries || f.roles_industries,
                  problems: d.problems || f.problems,
                  desired_outcomes: d.desired_outcomes || f.desired_outcomes,
                  objections: d.objections || f.objections,
                  alternatives: d.alternatives || f.alternatives,
                }));
              }}
            />
          </div>
        </div>
        {justSaved ? (
          <div className="flex flex-col gap-3 py-1">
            <div className="text-sm text-slate-600">Saved. What would you like to do next?</div>
            <div className="flex flex-wrap gap-2">
              <Link to={`/marketing-kit/audiences/${justSaved.id}`}><Button size="sm"><Eye className="w-3.5 h-3.5 mr-1.5" /> View persona card</Button></Link>
              <Link to={`/guided-setup?audience=${justSaved.id}`}><Button size="sm" variant="outline"><Sparkles className="w-3.5 h-3.5 mr-1.5" /> Build a funnel for this audience</Button></Link>
              <Button size="sm" variant="ghost" onClick={() => { onSaved(justSaved); }}>Done</Button>
            </div>
          </div>
        ) : (
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
        )}
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