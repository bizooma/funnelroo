import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import AppShell from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { Search, ChevronRight } from "lucide-react";

export default function Contacts() {
  const { current } = useWorkspace();
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [funnels, setFunnels] = useState([]);
  const [funnelFilter, setFunnelFilter] = useState("");

  async function load() {
    if (!current) return;
    setLoading(true);
    try {
      const [cRes, fRes] = await Promise.all([
        base44.functions.invoke("contactsAccess", { action: "list", workspace_id: current.id, search }),
        base44.functions.invoke("funnelAccess", { action: "list", workspace_id: current.id }),
      ]);
      setContacts(cRes.data?.contacts || []);
      setFunnels(fRes.data?.funnels || []);
    } catch {
      toast({ title: "Could not load contacts", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [current]);

  // client-side funnel filter (participating funnels are joined on the server)
  const filtered = funnelFilter
    ? contacts.filter((c) => (c.funnels || []).some((f) => f.funnel_name === funnels.find((fn) => fn.id === funnelFilter)?.name))
    : contacts;

  return (
    <AppShell>
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Contacts</h1>
        <p className="text-sm text-slate-500 mb-6">People who submitted a funnel form in this workspace.</p>

        <div className="flex gap-3 mb-5">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="Search name, email, company…" className="pl-9" />
          </div>
          <select value={funnelFilter} onChange={(e) => setFunnelFilter(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white">
            <option value="">All funnels</option>
            {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={load}>Refresh</Button>
        </div>

        {loading ? (
          <div className="p-8"><div className="w-8 h-8 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <Card><CardContent className="p-10 text-center text-sm text-slate-400">No contacts yet. They'll appear here after someone submits a published funnel.</CardContent></Card>
        ) : (
          <Card>
            <div className="divide-y divide-slate-100">
              {filtered.map((c) => (
                <button key={c.id} onClick={() => navigate(`/contacts/${c.id}`)} className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 text-left">
                  <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold shrink-0">
                    {(c.display_name || c.email || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-800 truncate">{c.display_name || c.email}</div>
                    <div className="text-xs text-slate-500 truncate">{c.email}{c.company ? ` · ${c.company}` : ""}</div>
                  </div>
                  <div className="hidden md:block text-xs text-slate-400 truncate max-w-[200px]">
                    {(c.funnels || []).map((f) => f.funnel_name).join(", ") || "—"}
                  </div>
                  <div className="text-xs text-slate-400 whitespace-nowrap">
                    {c.latest_activity ? new Date(c.latest_activity).toLocaleDateString() : ""}
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300" />
                </button>
              ))}
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}