import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, FileText, CalendarCheck, MessageSquare, Loader2, Search } from "lucide-react";

const TEMPLATES = [
  { type: "lead_magnet", label: "Lead magnet to booking", desc: "Landing form, resource delivery, thank-you page, optional video and scheduler, eligible follow-up.", icon: FileText },
  { type: "direct_booking", label: "Direct booking", desc: "Focused offer page and scheduler. Contact created from a verified booking — no redundant lead form.", icon: CalendarCheck },
  { type: "service_inquiry", label: "Service inquiry", desc: "Offer, inquiry form, accepted-submission confirmation and team follow-up.", icon: MessageSquare },
];

export default function Funnels() {
  const { current, loading } = useWorkspace();
  const navigate = useNavigate();
  const [funnels, setFunnels] = useState([]);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("lead_magnet");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("type");
    if (t === "lead_magnet" || t === "direct_booking" || t === "service_inquiry") setType(t);
    if (params.get("new") === "1") setOpen(true);
  }, []);

  async function load() {
    if (!current) return;
    const res = await base44.functions.invoke("funnelAccess", { action: "list", workspace_id: current.id });
    setFunnels(res.data?.funnels || []);
  }

  useEffect(() => { load(); }, [current]);

  async function create() {
    setCreating(true);
    try {
      const res = await base44.functions.invoke("funnelAccess", {
        action: "create", workspace_id: current.id, name, type,
      });
      setOpen(false);
      setName("");
      navigate(`/funnels/${res.data.funnel.id}`);
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" /></div>;
  if (!current) return null;

  const filtered = funnels.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <AppShell>
      <div className="p-8 max-w-5xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Funnels</h1>
            <p className="text-sm text-slate-500 mt-1">Create, edit and publish your conversion journeys.</p>
          </div>
          <Button onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-1.5" /> New funnel</Button>
        </div>

        <div className="relative mb-5 max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search funnels" className="pl-9" />
        </div>

        {filtered.length === 0 ? (
          <div className="border border-dashed border-slate-200 rounded-2xl p-12 text-center">
            <p className="text-sm text-slate-500">{funnels.length === 0 ? "No funnels yet." : "No matches."}</p>
            {funnels.length === 0 && <Button className="mt-4" onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-1.5" /> Create your first funnel</Button>}
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((f) => (
              <Card key={f.id} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate(`/funnels/${f.id}`)}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                      {React.createElement(TEMPLATES.find((t) => t.type === f.type)?.icon || FileText, { className: "w-5 h-5 text-indigo-600" })}
                    </div>
                    <div>
                      <div className="font-medium text-slate-800">{f.name}</div>
                      <div className="text-xs text-slate-400 capitalize">{f.type.replace("_", " ")} · /f/{f.slug}</div>
                    </div>
                  </div>
                  <StateBadge state={f.state} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create a funnel</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="fn">Funnel name</Label>
              <Input id="fn" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Discovery call funnel" className="mt-1.5" />
            </div>
            <div>
              <Label>Template</Label>
              <div className="space-y-2 mt-1.5">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.type}
                    onClick={() => setType(t.type)}
                    className={`w-full text-left flex items-start gap-3 p-3 rounded-xl border transition-colors ${type === t.type ? "border-indigo-500 bg-indigo-50/50" : "border-slate-200 hover:bg-slate-50"}`}
                  >
                    <t.icon className="w-5 h-5 mt-0.5 text-indigo-600 shrink-0" />
                    <div>
                      <div className="text-sm font-medium text-slate-800">{t.label}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{t.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!name.trim() || creating} onClick={create}>
              {creating && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              {creating ? "Creating…" : "Create funnel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function StateBadge({ state }) {
  const map = { draft: "bg-slate-100 text-slate-600", published: "bg-emerald-100 text-emerald-700", paused: "bg-amber-100 text-amber-700", archived: "bg-slate-100 text-slate-400" };
  return <span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${map[state] || map.draft}`}>{state}</span>;
}