import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import { MascotBadge } from "@/components/MascotBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Check, ArrowRight, ArrowLeft } from "lucide-react";

const STEPS = ["Workspace", "Business", "Audience & Offer", "Review"];

export default function Onboarding() {
  const navigate = useNavigate();
  const { createWorkspace, refresh } = useWorkspace();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    name: "", time_zone: "America/Chicago", currency: "USD",
    business_name: "", website: "", primary_service: "", brand_voice: "", contact_email: "",
    audience_summary: "", offer_summary: "", approved_facts: "",
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      const ws = await createWorkspace({
        name: form.name,
        time_zone: form.time_zone,
        currency: form.currency,
      });
      const facts = form.approved_facts.split("\n").map((s) => s.trim()).filter(Boolean);
      await base44.functions.invoke("briefAccess", {
        action: "updateBusinessProfile",
        workspace_id: ws.id,
        business_name: form.business_name || form.name,
        website: form.website,
        primary_service: form.primary_service,
        brand_voice: form.brand_voice,
        contact_email: form.contact_email,
        audience_summary: form.audience_summary,
        offer_summary: form.offer_summary,
        approved_facts: facts,
        onboarding_complete: true,
      });
      await refresh();
      navigate("/");
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Could not save. Please try again.");
      setSaving(false);
    }
  }

  const canNext = step === 0 ? form.name.trim() : step === 1 ? form.business_name.trim() || form.name.trim() : true;

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50/40 to-white flex items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <div className="flex items-center gap-3 mb-8">
          <MascotBadge size={48} />
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Welcome to FunnelRoo</h1>
            <p className="text-sm text-slate-500">Let's set up your workspace. Roo will guide you.</p>
          </div>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${i < step ? "bg-indigo-600 text-white" : i === step ? "bg-indigo-100 text-indigo-700 ring-2 ring-indigo-600" : "bg-slate-100 text-slate-400"}`}>
                {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className={`text-xs ${i === step ? "text-slate-800 font-medium" : "text-slate-400"}`}>{s}</span>
              {i < STEPS.length - 1 && <div className={`h-px flex-1 ${i < step ? "bg-indigo-300" : "bg-slate-200"}`} />}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Workspace name</Label>
                <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Murphy Consulting" className="mt-1.5" />
                <p className="text-xs text-slate-400 mt-1">This is your team workspace, billed separately from any others you join.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="tz">Time zone</Label>
                  <Input id="tz" value={form.time_zone} onChange={(e) => set("time_zone", e.target.value)} className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="cur">Currency</Label>
                  <Input id="cur" value={form.currency} onChange={(e) => set("currency", e.target.value)} className="mt-1.5" />
                </div>
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="bn">Business name</Label>
                <Input id="bn" value={form.business_name} onChange={(e) => set("business_name", e.target.value)} placeholder={form.name} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="web">Website</Label>
                <Input id="web" value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="ps">Primary product or service</Label>
                <Textarea id="ps" value={form.primary_service} onChange={(e) => set("primary_service", e.target.value)} rows={2} className="mt-1.5" placeholder="What you sell and how" />
              </div>
              <div>
                <Label htmlFor="bv">Brand voice</Label>
                <Input id="bv" value={form.brand_voice} onChange={(e) => set("brand_voice", e.target.value)} placeholder="e.g. warm, direct, expert" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="ce">Contact email</Label>
                <Input id="ce" type="email" value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} className="mt-1.5" />
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="as">Who is your audience?</Label>
                <Textarea id="as" value={form.audience_summary} onChange={(e) => set("audience_summary", e.target.value)} rows={3} className="mt-1.5" placeholder="Roles, industries, problems they have" />
              </div>
              <div>
                <Label htmlFor="os">What's your offer?</Label>
                <Textarea id="os" value={form.offer_summary} onChange={(e) => set("offer_summary", e.target.value)} rows={3} className="mt-1.5" placeholder="The offer and the action you want them to take" />
              </div>
              <div>
                <Label htmlFor="af">Approved facts (one per line)</Label>
                <Textarea id="af" value={form.approved_facts} onChange={(e) => set("approved_facts", e.target.value)} rows={3} className="mt-1.5" placeholder="Only facts you can stand behind. Roo will not invent proof." />
                <p className="text-xs text-slate-400 mt-1">Roo uses these as the basis for every draft. It will never invent testimonials or results.</p>
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">Review your brief. You can refine it later in Settings.</p>
              <dl className="text-sm space-y-2 bg-slate-50 rounded-lg p-4">
                <Row k="Workspace" v={form.name} />
                <Row k="Business" v={form.business_name || form.name} />
                <Row k="Service" v={form.primary_service || "—"} />
                <Row k="Audience" v={form.audience_summary || "—"} />
                <Row k="Offer" v={form.offer_summary || "—"} />
              </dl>
            </div>
          )}

          {error && <div className="mt-4 text-sm text-rose-600 bg-rose-50 rounded-lg p-3">{error}</div>}

          <div className="flex items-center justify-between mt-6">
            <Button variant="ghost" disabled={step === 0 || saving} onClick={() => setStep(step - 1)}>
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button disabled={!canNext} onClick={() => setStep(step + 1)}>
                Continue <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            ) : (
              <Button disabled={saving} onClick={finish}>
                {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                {saving ? "Creating workspace…" : "Create workspace"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex gap-3">
      <dt className="text-slate-400 w-24 shrink-0">{k}</dt>
      <dd className="text-slate-700">{v}</dd>
    </div>
  );
}