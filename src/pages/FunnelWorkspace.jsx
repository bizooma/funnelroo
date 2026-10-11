import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import AppShell from "@/components/AppShell";
import { BlockEditor } from "@/components/funnel/BlockEditor";
import { FunnelResourceTab } from "@/components/funnel/FunnelResourceTab";
import { ComingSoon } from "@/components/ComingSoon";
import { RooPanel } from "@/components/RooPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import {
  Loader2, Rocket, Pause, Play, ExternalLink, Check, X, Sparkles, ArrowLeft,
} from "lucide-react";

const TABS = [
  { id: "plan", label: "Plan" },
  { id: "pages", label: "Pages" },
  { id: "resource", label: "Resource" },
  { id: "followup", label: "Follow-up", soon: "Phase 2-3" },
  { id: "traffic", label: "Traffic", soon: "Phase 3" },
  { id: "results", label: "Results", soon: "Phase 3" },
];

export default function FunnelWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { current, canPublish } = useWorkspace();
  const [funnel, setFunnel] = useState(null);
  const [draft, setDraft] = useState(null);
  const [tab, setTab] = useState("plan");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [brief, setBrief] = useState({ audiences: [], offers: [] });

  async function load() {
    if (!current || !id) return;
    setLoading(true);
    try {
      const [fRes, bRes] = await Promise.all([
        base44.functions.invoke("funnelAccess", { action: "get", funnel_id: id }),
        base44.functions.invoke("briefAccess", { action: "getBrief", workspace_id: current.id }),
      ]);
      setFunnel(fRes.data?.funnel);
      setDraft(fRes.data?.draft);
      setBrief({ audiences: bRes.data?.audiences || [], offers: bRes.data?.offers || [] });
    } catch (e) {
      toast({ title: "Could not load funnel", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [current, id]);

  async function saveBlocks(blocks) {
    setSaving(true);
    try {
      const res = await base44.functions.invoke("funnelAccess", {
        action: "saveDraft", funnel_id: id, page_blocks: blocks,
      });
      setDraft(res.data?.draft);
      toast({ title: "Saved" });
    } catch (e) {
      toast({ title: "Save failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setPublishing(true);
    try {
      // compute checks from draft
      const blocks = draft?.page_blocks || [];
      const hasForm = blocks.some((b) => b.type === "form");
      const hasResource = blocks.some((b) => b.type === "resource");
      const hasBooking = blocks.some((b) => b.type === "booking" && b.props?.calendly_url);
      const checks = { has_form: hasForm, has_resource: !!draft?.resource_version_id, has_booking: hasBooking, has_sender: draft?.delivery_mode === "immediate_plus_email" && !!draft?.sender_id };
      await base44.functions.invoke("funnelAccess", { action: "saveDraft", funnel_id: id, publishing_checks: checks });
      const res = await base44.functions.invoke("funnelAccess", { action: "publish", funnel_id: id });
      await load();
      toast({ title: "Funnel published", description: `Version ${res.data?.version?.version_number} is now live.` });
    } catch (e) {
      toast({ title: "Publishing blocked", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  }

  async function setState(state) {
    try {
      await base44.functions.invoke("funnelAccess", { action: "setState", funnel_id: id, state });
      await load();
    } catch (e) {
      toast({ title: "Failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    }
  }

  async function linkAudienceOffer(field, value) {
    try {
      await base44.functions.invoke("funnelAccess", { action: "update", funnel_id: id, [field]: value });
      setFunnel((f) => ({ ...f, [field]: value }));
    } catch (e) {
      toast({ title: "Failed", variant: "destructive" });
    }
  }

  if (loading) return <AppShell><div className="p-8"><div className="w-8 h-8 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" /></div></AppShell>;
  if (!funnel) return <AppShell><div className="p-8 text-sm text-slate-500">Funnel not found.</div></AppShell>;

  const blocks = draft?.page_blocks || [];
  const checks = {
    has_form: blocks.some((b) => b.type === "form"),
    has_resource: !!draft?.resource_version_id,
    has_booking: blocks.some((b) => b.type === "booking" && b.props?.calendly_url),
    has_sender: draft?.delivery_mode === "immediate_plus_email" && !!draft?.sender_id,
  };
  const readiness = [
    { label: "Landing page sections", ok: blocks.length >= 2 },
    { label: "Lead form", ok: checks.has_form, needed: funnel.type !== "direct_booking" },
    { label: "Approved resource version", ok: checks.has_resource, needed: funnel.type === "lead_magnet" },
    { label: "Verified sender (email delivery)", ok: checks.has_sender, needed: funnel.type === "lead_magnet" && draft?.delivery_mode === "immediate_plus_email" },
    { label: "Booking connection", ok: checks.has_booking, needed: funnel.type === "direct_booking" || funnel.type === "lead_magnet" },
  ].filter((r) => r.needed !== false);

  return (
    <AppShell>
      <div className="p-8 max-w-5xl">
        <button onClick={() => navigate("/funnels")} className="text-sm text-slate-400 hover:text-slate-600 flex items-center gap-1 mb-4">
          <ArrowLeft className="w-4 h-4" /> All funnels
        </button>

        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{funnel.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-slate-400 capitalize">{funnel.type.replace("_", " ")}</span>
              <span className="text-slate-300">·</span>
              <span className="text-xs text-slate-400">/f/{funnel.public_id}</span>
              <StateBadge state={funnel.state} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {funnel.state === "published" && (
              <a href={`/f/${funnel.public_id}`} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm"><ExternalLink className="w-3.5 h-3.5 mr-1.5" /> View live</Button>
              </a>
            )}
            {funnel.state === "published" && canPublish && (
              <Button variant="outline" size="sm" onClick={() => setState("paused")}><Pause className="w-3.5 h-3.5 mr-1.5" /> Pause</Button>
            )}
            {funnel.state === "paused" && canPublish && (
              <Button variant="outline" size="sm" onClick={() => setState("published")}><Play className="w-3.5 h-3.5 mr-1.5" /> Resume</Button>
            )}
            {canPublish && (
              <Button size="sm" disabled={publishing} onClick={publish}>
                {publishing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Rocket className="w-4 h-4 mr-1.5" />}
                {publishing ? "Publishing…" : "Publish"}
              </Button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-200 mb-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${tab === t.id ? "text-indigo-600" : "text-slate-500 hover:text-slate-700"}`}
            >
              {t.label}
              {t.soon && <span className="ml-1.5 text-[9px] uppercase bg-slate-100 text-slate-400 px-1 py-0.5 rounded">{t.soon}</span>}
              {tab === t.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />}
            </button>
          ))}
        </div>

        {tab === "plan" && (
          <div className="space-y-6">
            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold text-slate-800 mb-4">Audience & offer</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-slate-500">Linked audience</Label>
                    <select value={funnel.audience_id || ""} onChange={(e) => linkAudienceOffer("audience_id", e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white">
                      <option value="">— none —</option>
                      {brief.audiences.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <p className="text-xs text-slate-400 mt-1">Define audiences in Settings.</p>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500">Linked offer</Label>
                    <select value={funnel.offer_id || ""} onChange={(e) => linkAudienceOffer("offer_id", e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white">
                      <option value="">— none —</option>
                      {brief.offers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <RooPanel title="Draft page copy" action="draftPageCopy" extraPayload={{ funnel_type: funnel.type }} onApply={(d) => {
                    if (d.hero) {
                      const next = blocks.map((b) => b.type === "hero" ? { ...b, props: { ...b.props, ...d.hero } } : b);
                      if (!next.some((b) => b.type === "hero")) next.unshift({ id: crypto.randomUUID(), type: "hero", props: d.hero });
                      saveBlocks(next);
                    }
                  }} />
                  <RooPanel title="What's next?" action="suggestNextStep" context={{ type: funnel.type, state: funnel.state, readiness }} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold text-slate-800 mb-1">Publishing readiness</h3>
                <p className="text-xs text-slate-500 mb-4">Checks are specific to this funnel's template. Email sender and nurture sequence connect in a later phase.</p>
                <div className="space-y-2.5">
                  {readiness.map((r, i) => (
                    <div key={i} className="flex items-center gap-2.5 text-sm">
                      {r.ok ? <Check className="w-4 h-4 text-emerald-500" /> : <X className="w-4 h-4 text-slate-300" />}
                      <span className={r.ok ? "text-slate-700" : "text-slate-400"}>{r.label}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2.5 text-sm">
                    <X className="w-4 h-4 text-slate-300" />
                    <span className="text-slate-400">Email sender & nurture sequence <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded ml-1">Phase 2-3</span></span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {tab === "pages" && (
          <BlockEditor blocks={blocks} theme={draft?.theme} saving={saving} onSave={saveBlocks} />
        )}

        {tab === "resource" && (
          <FunnelResourceTab funnel={funnel} draft={draft} onChanged={load} />
        )}
        {tab === "followup" && (
          <Card><CardContent><ComingSoon title="Nurture sequences" description="Approved email sequences with delays, eligibility checks and stop rules. One active promotional sequence per contact per workspace." phase="Follow-on Phase 2-3" /></CardContent></Card>
        )}
        {tab === "traffic" && (
          <Card><CardContent><ComingSoon title="Campaigns & traffic" description="Ad copy, image briefs, UTM-tagged links and manual/CSV spend imports. No automatic ad buying in V1." phase="Follow-on Phase 3" /></CardContent></Card>
        )}
        {tab === "results" && (
          <Card><CardContent><ComingSoon title="Funnel results" description="Sessions, accepted forms, acquired leads, confirmed bookings, attendance and won outcomes — with template-specific metrics." phase="Follow-on Phase 3" /></CardContent></Card>
        )}
      </div>
    </AppShell>
  );
}

function StateBadge({ state }) {
  const map = { draft: "bg-slate-100 text-slate-600", published: "bg-emerald-100 text-emerald-700", paused: "bg-amber-100 text-amber-700", archived: "bg-slate-100 text-slate-400" };
  return <span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${map[state] || map.draft}`}>{state}</span>;
}