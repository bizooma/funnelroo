import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import PersonaCard from "@/components/persona/PersonaCard";
import PersonaCustomize from "@/components/persona/PersonaCustomize";
import PersonaRefine from "@/components/persona/PersonaRefine";
import { AudienceEditor } from "@/components/marketing-kit/AudienceManager";
import { buildCardData } from "@/components/persona/buildCardData";
import {
  ArrowLeft, Pencil, SlidersHorizontal, Sparkles, Copy, Download, Printer, Rocket, Loader2, AlertTriangle,
} from "lucide-react";

export default function AudienceDetail() {
  const { id } = useParams();
  const { current, loading: wsLoading, canAdmin } = useWorkspace();
  const navigate = useNavigate();
  const [audience, setAudience] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [customizing, setCustomizing] = useState(false);
  const [refining, setRefining] = useState(false);
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const cardRef = useRef(null);

  async function load() {
    if (!current || !id) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke("marketingKitAccess", { action: "getAudience", workspace_id: current.id, id });
      setAudience(res.data?.audience);
      setProfile(res.data?.profile);
      setDirty(false);
    } catch (e) {
      toast({ title: "Load failed", description: e.response?.data?.error || e.message, variant: "destructive" });
      navigate("/marketing-kit?area=audiences");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [current, id]);

  if (wsLoading || loading) return <AppShell><div className="p-8"><div className="w-8 h-8 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" /></div></AppShell>;
  if (!current) return null;
  if (!audience) return null;

  const cardData = buildCardData(audience, profile);
  const persona = audience.persona || {};
  const currentRevision = persona.content_hash;

  async function savePersona(next) {
    try {
      const res = await base44.functions.invoke("marketingKitAccess", {
        action: "savePersonaCard",
        workspace_id: current.id,
        id: audience.id,
        persona: next,
      });
      setAudience(res.data?.audience);
      setDirty(false);
      toast({ title: "Card saved" });
    } catch (e) {
      toast({ title: "Save failed", description: e.response?.data?.error || e.message, variant: "destructive" });
      throw e;
    }
  }

  function applyRefine(field, value) {
    const next = { ...audience.persona };
    if (field === "title") next.title = value;
    else if (field === "bio_summary") next.bio_summary = value;
    else if (field === "quote") { next.quote_text = value; next.quote_kind = "illustrative"; }
    else if (field === "motivations") {
      next.motivations = (value || []).map((label) => ({ label, rating: null }));
    }
    else if (field === "messaging") {
      next.messaging_guidance = (value || []).map((g) => ({ heading: g.heading || "", text: g.text || "" }));
      next.messaging_ai_suggested = true;
    }
    // Apply to local state; user saves explicitly via Customize or Save.
    setAudience((a) => ({ ...a, persona: next }));
    setDirty(true);
  }

  async function buildFunnel() {
    navigate(`/guided-setup?audience=${audience.id}`);
  }

  async function copySummary() {
    const text = summaryText(cardData);
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Summary copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  }

  async function downloadPng() {
    if (!cardRef.current) return;
    setExporting(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(cardRef.current, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `persona-${slug(audience.name)}.png`;
      a.click();
      toast({ title: "PNG downloaded" });
    } catch (e) {
      toast({ title: "Export failed", description: "The image could not be captured. Try Print / Save as PDF instead.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  function printCard() {
    document.body.classList.add("printing-persona");
    window.print();
    setTimeout(() => document.body.classList.remove("printing-persona"), 500);
  }

  const archived = audience.status === "archived";

  return (
    <AppShell>
      <div className="p-6 lg:p-8 max-w-[1200px]">
        {/* Top nav */}
        <div className="flex items-center gap-3 mb-4">
          <Link to="/marketing-kit?area=audiences" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="w-4 h-4" /> Audiences
          </Link>
          <span className="text-slate-300">/</span>
          <span className="text-sm font-medium text-slate-700">{audience.name}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full capitalize ${audience.status === "ready" ? "bg-emerald-100 text-emerald-700" : audience.status === "archived" ? "bg-slate-100 text-slate-400" : "bg-slate-100 text-slate-600"}`}>{audience.status}</span>
        </div>

        {/* Toolbar — above the card, not inside it */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <Button onClick={buildFunnel} disabled={archived}><Rocket className="w-4 h-4 mr-1.5" /> Build a funnel for this audience</Button>
          <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="w-4 h-4 mr-1.5" /> Edit audience</Button>
          <Button variant="outline" onClick={() => setCustomizing(true)}><SlidersHorizontal className="w-4 h-4 mr-1.5" /> Customize card</Button>
          <Button variant="outline" onClick={() => setRefining(true)}><Sparkles className="w-4 h-4 mr-1.5" /> Refine with Roo</Button>
          {dirty && (
            <Button onClick={async () => { try { await savePersona(audience.persona); } catch {} }}>
              <span className="w-2 h-2 rounded-full bg-amber-500 mr-1.5" /> Save changes
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={copySummary}><Copy className="w-4 h-4 mr-1.5" /> Copy summary</Button>
          <Button variant="ghost" size="sm" onClick={downloadPng} disabled={exporting}>
            {exporting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />} Download PNG
          </Button>
          <Button variant="ghost" size="sm" onClick={printCard}><Printer className="w-4 h-4 mr-1.5" /> Print / Save as PDF</Button>
        </div>

        {persona.stale && (
          <div className="flex items-start gap-2 mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-medium">Needs refresh.</span> The audience profile changed since this card was last customized. Review and re-save the card, or ask Roo to refine it again.
            </div>
          </div>
        )}

        {archived && (
          <div className="mb-4 text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
            This audience is archived. Its card remains viewable for history, but it cannot be selected for a new funnel.
          </div>
        )}

        {/* The exportable card */}
        <div className="persona-print-root rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white">
          <PersonaCard ref={cardRef} data={cardData} meta={cardData.meta} />
        </div>
      </div>

      {customizing && (
        <PersonaCustomize
          open={customizing}
          persona={audience.persona || {}}
          onClose={() => setCustomizing(false)}
          onSave={savePersona}
        />
      )}

      {refining && (
        <PersonaRefine
          open={refining}
          audienceId={audience.id}
          currentRevision={currentRevision}
          onClose={() => setRefining(false)}
          onApply={applyRefine}
        />
      )}

      {editing && (
        <AudienceEditor
          audience={audience}
          onClose={() => setEditing(false)}
          onSaved={(updated) => { setEditing(false); setAudience(updated); }}
        />
      )}
    </AppShell>
  );
}

function slug(name) {
  return (name || "persona").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function summaryText(d) {
  const lines = [];
  lines.push(`${d.title}${d.subtitle ? ` — ${d.subtitle}` : ""}`);
  lines.push(`PERSONA CARD — ${d.meta.businessName || ""}`);
  lines.push("");
  if (d.facts.length) {
    lines.push("WHO THEY ARE");
    d.facts.forEach((f) => lines.push(`  ${f.label}: ${f.value}`));
    lines.push("");
  }
  if (d.bio) { lines.push("BIO"); lines.push(d.bio); lines.push(""); }
  if (d.quote?.text) {
    const kind = d.quote.kind === "customer" ? "Customer quote" : d.quote.kind === "illustrative" ? "Illustrative statement — not a customer quote" : "Representative statement";
    lines.push(`${kind}: "${d.quote.text}"${d.quote.source ? ` (Source: ${d.quote.source})` : ""}`);
    lines.push("");
  }
  if (d.motivations.length) {
    lines.push("PURCHASING MOTIVATIONS (your team's assessment)");
    d.motivations.forEach((m) => lines.push(`  ${m.label}: ${m.rating ? ["","Lower","Lower","Moderate","Higher","Higher"][m.rating] : "Not rated"}`));
    lines.push("");
  }
  if (d.goals.length) { lines.push("GOALS"); d.goals.forEach((g) => lines.push(`  • ${g}`)); lines.push(""); }
  if (d.frustrations.length) { lines.push("FRUSTRATIONS"); d.frustrations.forEach((g) => lines.push(`  • ${g}`)); lines.push(""); }
  if (d.objections.length) { lines.push("OBJECTIONS"); d.objections.forEach((g) => lines.push(`  • ${g}`)); lines.push(""); }
  if (d.buyingStyle.length) { lines.push("BUYING STYLE (team assumptions)"); d.buyingStyle.forEach((b) => lines.push(`  ${b.left} ↔ ${b.right} (${b.position})`)); lines.push(""); }
  if (d.messagingGuidance.length) {
    lines.push(`MESSAGING GUIDANCE${d.meta.messagingAiSuggested ? " (Suggested by Roo — reviewed)" : ""}`);
    d.messagingGuidance.forEach((g) => lines.push(`  ${g.heading ? `${g.heading}: ` : ""}${g.text}`));
    lines.push("");
  }
  if (d.alternatives.length) { lines.push("CURRENT TOOLS & ALTERNATIVES"); d.alternatives.forEach((g) => lines.push(`  • ${g}`)); lines.push(""); }
  lines.push(`Prepared with FunnelRoo · Rev ${d.meta.revision ? d.meta.revision.slice(0, 8) : "—"} · Updated ${d.meta.updatedAt} · ${d.meta.reviewLabel}${d.meta.stale ? " · Needs refresh" : ""}`);
  return lines.join("\n");
}