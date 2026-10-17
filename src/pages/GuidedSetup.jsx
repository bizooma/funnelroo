import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import AppShell from "@/components/AppShell";
import { MascotBadge } from "@/components/MascotBadge";
import { RooPanel } from "@/components/RooPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import {
  Check, ArrowRight, ArrowLeft, Loader2, Sparkles, FileText, CalendarCheck, MessageSquare, Package,
} from "lucide-react";

const STEPS = [
  { id: "prepare_business", label: "Business", group: "Prepare" },
  { id: "prepare_audience", label: "Audience", group: "Prepare" },
  { id: "prepare_offer", label: "Offer & goal", group: "Prepare" },
  { id: "prepare_resource", label: "Resource", group: "Prepare" },
  { id: "build_review", label: "Review", group: "Build" },
  { id: "build_create", label: "Create", group: "Build" },
  { id: "launch", label: "Launch", group: "Launch" },
];

const TEMPLATES = [
  { type: "lead_magnet", label: "Request a free resource", desc: "Visitors request a guide, checklist, or file.", icon: FileText },
  { type: "direct_booking", label: "Book a demo or consultation", desc: "Visitors book a call directly.", icon: CalendarCheck },
  { type: "service_inquiry", label: "Send an inquiry", desc: "Visitors send a message and you follow up.", icon: MessageSquare },
];

export default function GuidedSetup() {
  const { current, loading, canAdmin } = useWorkspace();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [sessionId, setSessionId] = useState(params.get("session"));
  const [step, setStep] = useState("prepare_business");
  const [mode, setMode] = useState(null); // "guided" | "blank"
  const [form, setForm] = useState({
    funnel_name: "",
    template: "lead_magnet",
    audience_id: "",
    offer_id: "",
    resource_id: "",
    resource_concept: "",
  });
  const [brief, setBrief] = useState({ profile: {}, audiences: [], offers: [] });
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!current) return;
    (async () => {
      try {
        const bRes = await base44.functions.invoke("briefAccess", { action: "getBrief", workspace_id: current.id });
        setBrief({
          profile: bRes.data?.profile || {},
          audiences: (bRes.data?.audiences || []).filter((a) => a.status !== "archived"),
          offers: (bRes.data?.offers || []).filter((o) => o.status !== "archived"),
        });
        // Resume an existing session
        if (sessionId) {
          const sRes = await base44.functions.invoke("marketingKitAccess", { action: "getSetupSession", workspace_id: current.id });
          const s = sRes.data?.session;
          if (s) {
            setSessionId(s.id);
            setStep(s.step || "prepare_business");
            setMode(s.mode || "guided");
            setForm((f) => ({
              ...f,
              funnel_name: s.funnel_name || "",
              template: s.template || "lead_magnet",
              audience_id: s.audience_id || "",
              offer_id: s.offer_id || "",
              resource_id: s.resource_id || "",
              resource_concept: s.resource_concept || "",
            }));
          }
        }
      } catch {}
    })();
  }, [current, sessionId]);

  async function persistStep(newStep, extra = {}) {
    setSaving(true);
    try {
      const payload = {
        action: "saveSetupSession",
        workspace_id: current.id,
        id: sessionId,
        step: newStep,
        mode: mode || "guided",
        template: form.template,
        funnel_name: form.funnel_name,
        audience_id: form.audience_id,
        offer_id: form.offer_id,
        resource_id: form.resource_id,
        resource_concept: form.resource_concept,
        ...extra,
      };
      const res = await base44.functions.invoke("marketingKitAccess", payload);
      if (res.data?.session?.id) setSessionId(res.data.session.id);
    } catch (e) {
      toast({ title: "Save failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function next() {
    const idx = STEPS.findIndex((s) => s.id === step);
    // Skip resource step for non-lead-magnet
    if (step === "prepare_offer" && form.template !== "lead_magnet") {
      setStep("build_review");
      await persistStep("build_review");
      return;
    }
    if (idx < STEPS.length - 1) {
      const nextStep = STEPS[idx + 1].id;
      setStep(nextStep);
      await persistStep(nextStep);
    }
  }

  async function back() {
    const idx = STEPS.findIndex((s) => s.id === step);
    if (step === "build_review" && form.template !== "lead_magnet") {
      setStep("prepare_offer");
      return;
    }
    if (idx > 0) {
      setStep(STEPS[idx - 1].id);
    }
  }

  async function createFunnel() {
    setCreating(true);
    try {
      const res = await base44.functions.invoke("marketingKitAccess", {
        action: "createFunnelFromSetup",
        workspace_id: current.id,
        session_id: sessionId,
        name: form.funnel_name || "Untitled funnel",
        type: form.template,
        audience_id: form.audience_id,
        offer_id: form.offer_id,
        context_snapshot: {
          audience_id: form.audience_id,
          offer_id: form.offer_id,
          resource_id: form.resource_id,
        },
      });
      const funnel = res.data?.funnel;
      if (funnel) {
        toast({ title: "Funnel draft created" });
        navigate(`/funnels/${funnel.id}`);
      }
    } catch (e) {
      toast({ title: "Creation failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <AppShell><div className="p-8"><div className="w-8 h-8 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" /></div></AppShell>;
  if (!current) return null;

  // Mode selection screen
  if (!mode) {
    return (
      <AppShell>
        <div className="p-8 max-w-2xl">
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Build a funnel</h1>
          <p className="text-sm text-slate-500 mb-6">Choose how you'd like to start.</p>
          <div className="space-y-3">
            <button onClick={() => setMode("guided")} className="w-full text-left p-5 rounded-xl border-2 border-indigo-500 bg-indigo-50/50 hover:bg-indigo-50 transition-colors">
              <div className="flex items-center gap-3">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <div>
                  <div className="font-medium text-slate-800">Build with Roo</div>
                  <div className="text-xs text-slate-500 mt-0.5">Recommended. Roo guides you through audience, offer, and page content.</div>
                </div>
              </div>
            </button>
            <button onClick={() => { setMode("blank"); setStep("build_review"); }} className="w-full text-left p-5 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-slate-400" />
                <div>
                  <div className="font-medium text-slate-800">Start a blank draft</div>
                  <div className="text-xs text-slate-500 mt-0.5">Skip guidance and create a funnel draft you can edit manually.</div>
                </div>
              </div>
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const stepIdx = STEPS.findIndex((s) => s.id === step);
  const isLast = step === "launch";

  return (
    <AppShell>
      <div className="p-8 max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <MascotBadge size={40} src={current.mascot_image_url} />
          <div>
            <h1 className="text-xl font-bold text-slate-900">Build your funnel</h1>
            <p className="text-sm text-slate-500">{mode === "guided" ? "Roo will guide you through each step." : "A blank draft you can edit manually."}</p>
          </div>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-1.5 mb-6">
          {STEPS.map((s, i) => {
            const reached = i <= stepIdx;
            const isCurrent = s.id === step;
            // Skip resource step for non-lead-magnet in display
            if (s.id === "prepare_resource" && form.template !== "lead_magnet") return null;
            return (
              <div key={s.id} className="flex items-center gap-1.5 flex-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium ${reached ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-400"} ${isCurrent ? "ring-2 ring-indigo-300" : ""}`}>
                  {i < stepIdx ? <Check className="w-3 h-3" /> : i + 1}
                </div>
                <span className={`text-[11px] ${isCurrent ? "text-slate-800 font-medium" : reached ? "text-slate-500" : "text-slate-400"}`}>{s.label}</span>
                {i < STEPS.length - 1 && <div className={`h-px flex-1 ${reached ? "bg-indigo-300" : "bg-slate-200"}`} />}
              </div>
            );
          })}
        </div>

        <Card>
          <CardContent className="p-6">
            {/* PREPARE: Business */}
            {step === "prepare_business" && (
              <div className="space-y-4">
                <StepHeader title="Business basics" desc="Confirm or edit your business information. You can refine it later in the Marketing kit." />
                <Field label="Business name"><Input value={brief.profile?.business_name || ""} onChange={(e) => setBrief((b) => ({ ...b, profile: { ...b.profile, business_name: e.target.value } }))} /></Field>
                <Field label="What does your business do?"><Textarea value={brief.profile?.primary_service || ""} onChange={(e) => setBrief((b) => ({ ...b, profile: { ...b.profile, primary_service: e.target.value } }))} rows={2} /></Field>
                <Button size="sm" variant="outline" onClick={async () => {
                  await base44.functions.invoke("marketingKitAccess", { action: "updateBusinessProfile", workspace_id: current.id, ...brief.profile });
                  toast({ title: "Saved" });
                }}><Loader2 className="w-3.5 h-3.5 mr-1" /> Save business info</Button>
              </div>
            )}

            {/* PREPARE: Audience */}
            {step === "prepare_audience" && (
              <div className="space-y-4">
                <StepHeader title="Who is this funnel for?" desc="Choose a saved audience or create one here. Roo will use it to tailor your message." />
                <AssetPicker
                  label="Audience"
                  items={brief.audiences}
                  value={form.audience_id}
                  onChange={(id) => set("audience_id", id)}
                  onCreate={() => navigate("/marketing-kit?area=audiences")}
                  createLabel="Create an audience"
                  renderSummary={(a) => a.roles_industries || a.name}
                />
                <div className="flex items-center gap-2">
                  <RooPanel title="Help me define my audience" action="draftAudience" onApply={(d) => {
                    if (d.name) {
                      base44.functions.invoke("marketingKitAccess", {
                        action: "saveAudience", workspace_id: current.id,
                        name: d.name, roles_industries: d.roles_industries,
                        problems: d.problems, desired_outcomes: d.desired_outcomes,
                        objections: d.objections, status: "draft",
                      }).then((res) => {
                        toast({ title: "Audience draft created — review and mark ready" });
                        setBrief((b) => ({ ...b, audiences: [...b.audiences, res.data?.audience] }));
                        set("audience_id", res.data?.audience?.id);
                      });
                    }
                  }} />
                </div>
              </div>
            )}

            {/* PREPARE: Offer & Goal */}
            {step === "prepare_offer" && (
              <div className="space-y-4">
                <StepHeader title="What are you promoting?" desc="Choose or create an offer, then pick the action visitors should take first." />
                <AssetPicker
                  label="Offer"
                  items={brief.offers}
                  value={form.offer_id}
                  onChange={(id) => {
                    const o = brief.offers.find((x) => x.id === id);
                    set("offer_id", id);
                    if (o?.goal) set("template", o.goal);
                  }}
                  onCreate={() => navigate("/marketing-kit?area=offers")}
                  createLabel="Create an offer"
                  renderSummary={(o) => o.offer || o.name}
                />
                <div>
                  <Label className="text-xs text-slate-500">What should visitors do first?</Label>
                  <div className="space-y-2 mt-1.5">
                    {TEMPLATES.map((t) => (
                      <button key={t.type} onClick={() => set("template", t.type)} className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors ${form.template === t.type ? "border-indigo-500 bg-indigo-50/50" : "border-slate-200 hover:bg-slate-50"}`}>
                        <t.icon className="w-4 h-4 mt-0.5 text-indigo-600 shrink-0" />
                        <div>
                          <div className="text-sm font-medium text-slate-800">{t.label}</div>
                          <div className="text-xs text-slate-500 mt-0.5">{t.desc}</div>
                        </div>
                        {form.template === t.type && <Check className="w-4 h-4 text-indigo-600 ml-auto" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* PREPARE: Resource */}
            {step === "prepare_resource" && (
              <div className="space-y-4">
                <StepHeader title="Your resource" desc="Choose an existing resource, upload one, or draft a concept now. You can attach the finished file later." />
                <div className="space-y-2">
                  <Button variant="outline" className="w-full justify-start" onClick={() => navigate("/resources")}>
                    <Package className="w-4 h-4 mr-2" /> Choose existing resource
                  </Button>
                  <Button variant="outline" className="w-full justify-start" onClick={() => navigate("/resources")}>
                    <Package className="w-4 h-4 mr-2" /> Upload a resource
                  </Button>
                </div>
                <Field label="Resource concept (optional)">
                  <Textarea value={form.resource_concept} onChange={(e) => set("resource_concept", e.target.value)} rows={3} placeholder="What resource would be useful for this audience? Roo can help draft an outline." />
                </Field>
                <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-xs text-amber-700">
                  A concept or outline helps with page drafting, but you'll need to attach a real file before launching a resource funnel.
                </div>
                <RooPanel title="Suggest resource ideas" action="draftAudience" onApply={() => {}} />
              </div>
            )}

            {/* BUILD: Review */}
            {step === "build_review" && (
              <div className="space-y-4">
                <StepHeader title="Review the plan" desc="Here's what will be created. You can edit anything later." />
                <div className="space-y-3">
                  <Field label="Funnel name"><Input value={form.funnel_name} onChange={(e) => set("funnel_name", e.target.value)} placeholder="e.g. Onboarding checklist funnel" /></Field>
                  <ReviewRow label="Audience" value={brief.audiences.find((a) => a.id === form.audience_id)?.name || "—"} onEdit={() => setStep("prepare_audience")} />
                  <ReviewRow label="Offer" value={brief.offers.find((o) => o.id === form.offer_id)?.name || "—"} onEdit={() => setStep("prepare_offer")} />
                  <ReviewRow label="Goal" value={TEMPLATES.find((t) => t.type === form.template)?.label || "—"} onEdit={() => setStep("prepare_offer")} />
                  {form.template === "lead_magnet" && (
                    <ReviewRow label="Resource" value={form.resource_concept ? "Concept drafted" : "Attach later"} onEdit={() => setStep("prepare_resource")} />
                  )}
                </div>
              </div>
            )}

            {/* BUILD: Create */}
            {step === "build_create" && (
              <div className="space-y-4 text-center py-6">
                <StepHeader title="Create your funnel draft" desc="This creates an editable draft. Nothing is published or sent." />
                <Button size="lg" disabled={creating || !form.funnel_name?.trim()} onClick={createFunnel}>
                  {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  {creating ? "Creating…" : "Create editable funnel draft"}
                </Button>
                <p className="text-xs text-slate-400">You can also create manually if Roo is unavailable.</p>
              </div>
            )}

            {/* LAUNCH */}
            {step === "launch" && (
              <div className="space-y-4 text-center py-6">
                <Check className="w-10 h-10 text-emerald-500 mx-auto" />
                <StepHeader title="Your draft is ready" desc="Open it to review pages, finish resource delivery, add booking, and test the visitor journey." />
                <Button size="lg" onClick={() => createFunnel()}>
                  Open funnel draft <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Nav */}
        <div className="flex items-center justify-between mt-6">
          <Button variant="ghost" disabled={stepIdx === 0 || saving || creating} onClick={back}>
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
          {!isLast && step !== "build_create" && (
            <Button disabled={saving} onClick={next}>
              {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
              Continue <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function StepHeader({ title, desc }) {
  return (
    <div>
      <h3 className="font-semibold text-slate-800">{title}</h3>
      <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
    </div>
  );
}

function AssetPicker({ label, items, value, onChange, onCreate, createLabel, renderSummary }) {
  return (
    <div>
      <Label className="text-xs text-slate-500">{label}</Label>
      <div className="mt-1.5 space-y-1.5">
        {items.length === 0 ? (
          <p className="text-xs text-slate-400">None saved yet.</p>
        ) : (
          items.map((item) => (
            <button key={item.id} onClick={() => onChange(item.id)} className={`w-full text-left p-2.5 rounded-lg border transition-colors ${value === item.id ? "border-indigo-500 bg-indigo-50/50" : "border-slate-200 hover:bg-slate-50"}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-800">{item.name}</span>
                {value === item.id && <Check className="w-3.5 h-3.5 text-indigo-600" />}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">{renderSummary(item)}</div>
            </button>
          ))
        )}
      </div>
      <button onClick={onCreate} className="text-xs text-indigo-600 hover:text-indigo-700 mt-2">{createLabel}</button>
    </div>
  );
}

function ReviewRow({ label, value, onEdit }) {
  return (
    <div className="flex items-center justify-between border border-slate-200 rounded-lg p-3">
      <div>
        <div className="text-xs text-slate-400">{label}</div>
        <div className="text-sm text-slate-800">{value}</div>
      </div>
      <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
    </div>
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