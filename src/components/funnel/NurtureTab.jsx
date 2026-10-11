import React, { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { RooPanel } from "@/components/RooPanel";
import { NurtureStepCard } from "@/components/funnel/NurtureStepCard";
import {
  Loader2, Plus, Save, CheckCircle2, Play, Pause, Archive,
  AlertCircle, Mail,
} from "lucide-react";

export function NurtureTab({ funnel, draft, onChanged }) {
  const { current, canAdmin } = useWorkspace();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [steps, setSteps] = useState([]);
  const [senderId, setSenderId] = useState("");
  const [bookingUrl, setBookingUrl] = useState("");
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const [testing, setTesting] = useState(null);
  const [blockers, setBlockers] = useState([]);

  async function load() {
    if (!funnel) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke("nurtureAccess", { action: "get", funnel_id: funnel.id });
      const d = res.data;
      setData(d);
      setSteps(d.sequence?.draft_steps || []);
      setSenderId(d.sequence?.sender_id || "");
      setBookingUrl(d.sequence?.booking_url || "");
      setDirty(false);
    } catch (e) {
      toast({ title: "Could not load nurture sequence", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [funnel?.id]);

  async function save() {
    if (!data?.sequence) return;
    setSaving(true);
    try {
      await base44.functions.invoke("nurtureAccess", {
        action: "saveDraft", sequence_id: data.sequence.id,
        draft_steps: steps, sender_id: senderId, booking_url: bookingUrl,
      });
      setDirty(false);
      toast({ title: "Draft saved" });
      await load();
    } catch (e) {
      toast({ title: "Save failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function review() {
    if (!data?.sequence) return;
    setSaving(true);
    try {
      if (dirty) await save();
      const res = await base44.functions.invoke("nurtureAccess", { action: "review", sequence_id: data.sequence.id });
      if (res.data?.version) {
        toast({ title: "Sequence reviewed", description: `Version ${res.data.version.version_number} approved.` });
        await load();
      }
    } catch (e) {
      toast({ title: "Review blocked", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function activate() {
    if (!data?.sequence) return;
    try {
      await base44.functions.invoke("nurtureAccess", { action: "activate", sequence_id: data.sequence.id });
      toast({ title: "Sequence activated", description: "New leads will be enrolled and emails will send on schedule." });
      await load();
    } catch (e) {
      if (e.response?.data?.blockers) {
        setBlockers(e.response.data.blockers);
      }
      toast({ title: "Activation blocked", description: e.response?.data?.error || e.message, variant: "destructive" });
    }
  }

  async function pause() {
    try {
      await base44.functions.invoke("nurtureAccess", { action: "pause", sequence_id: data.sequence.id });
      toast({ title: "Sequence paused" });
      await load();
    } catch (e) {
      toast({ title: "Failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    }
  }

  async function resume() {
    try {
      await base44.functions.invoke("nurtureAccess", { action: "resume", sequence_id: data.sequence.id });
      toast({ title: "Sequence resumed" });
      await load();
    } catch (e) {
      if (e.response?.data?.blockers) setBlockers(e.response.data.blockers);
      toast({ title: "Resume blocked", description: e.response?.data?.error || e.message, variant: "destructive" });
    }
  }

  async function archive() {
    try {
      await base44.functions.invoke("nurtureAccess", { action: "archive", sequence_id: data.sequence.id });
      toast({ title: "Sequence archived" });
      await load();
    } catch (e) {
      toast({ title: "Failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    }
  }

  async function testSend(stepIndex) {
    setTesting(stepIndex);
    try {
      const res = await base44.functions.invoke("nurtureAccess", { action: "testSend", sequence_id: data.sequence.id, step_index: stepIndex });
      if (res.data?.sent) {
        toast({ title: res.data.mock ? "Test sent (mock provider)" : "Test sent to your inbox", description: "Labeled TEST. Does not enroll or change consent." });
      } else {
        toast({ title: "Test send failed", description: res.data?.error || "Unknown error", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Test send failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setTesting(null);
    }
  }

  async function previewStep(stepIndex) {
    setPreviewing(stepIndex);
    try {
      const res = await base44.functions.invoke("nurtureAccess", { action: "preview", sequence_id: data.sequence.id, step_index: stepIndex });
      setPreview({ subject: res.data?.subject, html: res.data?.html, stepIndex });
    } catch (e) {
      toast({ title: "Preview failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setPreviewing(null);
    }
  }

  function createSequence() {
    base44.functions.invoke("nurtureAccess", { action: "create", funnel_id: funnel.id })
      .then(() => { toast({ title: "Sequence created with default 4 emails" }); load(); })
      .catch((e) => toast({ title: "Failed", description: e.response?.data?.error || e.message, variant: "destructive" }));
  }

  function updateStep(i, field, value) {
    const next = [...steps];
    next[i] = { ...next[i], [field]: value };
    setSteps(next);
    setDirty(true);
  }
  function addStep() {
    if (steps.length >= 5) return;
    setSteps([...steps, { delay_hours: 48, subject: "", preview: "", body: "", cta_label: "", cta_url: "" }]);
    setDirty(true);
  }
  function removeStep(i) {
    if (steps.length <= 3) return;
    setSteps(steps.filter((_, idx) => idx !== i));
    setDirty(true);
  }
  function moveStep(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    setSteps(next);
    setDirty(true);
  }

  if (loading) return <div className="p-8"><div className="w-8 h-8 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" /></div>;

  const seq = data?.sequence;
  const status = seq?.status || "none";
  const canEdit = canAdmin && (status === "draft" || status === "ready");
  const isPublished = funnel.state === "published";

  if (!seq) {
    return (
      <Card><CardContent className="p-8 text-center">
        <Mail className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <h3 className="font-semibold text-slate-800 mb-1">No nurture sequence yet</h3>
        <p className="text-sm text-slate-500 mb-4">Create a 4-email follow-up sequence that sends to opted-in leads on a schedule.</p>
        <Button onClick={createSequence}><Plus className="w-4 h-4 mr-1.5" />Create sequence</Button>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Status + actions */}
      <Card><CardContent className="p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <StatusBadge status={status} />
            {data.current_version && (
              <span className="text-xs text-slate-400">
                Approved v{data.current_version.version_number} · {data.versions?.length || 0} version(s)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {canEdit && dirty && (
              <Button size="sm" variant="outline" disabled={saving} onClick={save}>
                {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}Save draft
              </Button>
            )}
            {canAdmin && (status === "draft" || status === "ready") && (
              <Button size="sm" disabled={saving || dirty} onClick={review}>
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />Review &amp; approve
              </Button>
            )}
            {canAdmin && (status === "ready" || status === "paused") && (
              <Button size="sm" onClick={status === "ready" ? activate : resume}>
                <Play className="w-3.5 h-3.5 mr-1.5" />{status === "ready" ? "Activate" : "Resume"}
              </Button>
            )}
            {canAdmin && status === "active" && (
              <Button size="sm" variant="outline" onClick={pause}><Pause className="w-3.5 h-3.5 mr-1.5" />Pause</Button>
            )}
            {canAdmin && (status === "active" || status === "paused") && (
              <Button size="sm" variant="outline" onClick={archive}><Archive className="w-3.5 h-3.5 mr-1.5" />Archive</Button>
            )}
          </div>
        </div>

        {/* Provider status */}
        {!data.provider_configured && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 mt-4">
            <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-700">
              <span className="font-medium">Resend not configured.</span> Live sending is blocked. You can still draft, preview, and send test emails via the mock provider. Add your Resend API key in Secrets to enable live sending.
            </div>
          </div>
        )}
        {blockers.length > 0 && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 mt-3">
            <div className="text-xs font-medium text-rose-700 mb-1">Activation blocked:</div>
            <ul className="text-xs text-rose-600 list-disc list-inside space-y-0.5">
              {blockers.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        )}
      </CardContent></Card>

      {/* Roo assistance */}
      {canEdit && (
        <div className="flex items-center gap-2">
          <RooPanel
            title="Draft sequence with Roo"
            action="draftSequence"
            extraPayload={{ funnel_type: funnel.type }}
            onApply={(d) => {
              if (d.steps) { setSteps(d.steps); setDirty(true); toast({ title: "Sequence drafted — review and save" }); }
            }}
          />
        </div>
      )}

      {/* Steps */}
      <div className="space-y-3">
        {steps.map((step, i) => (
          <NurtureStepCard
            key={i}
            step={step}
            index={i}
            total={steps.length}
            onChange={updateStep}
            onRemove={removeStep}
            onMove={moveStep}
            onPreview={previewStep}
            onTestSend={testSend}
            previewing={testing === i ? i : previewing}
            canEdit={canEdit}
          />
        ))}
        {canEdit && steps.length < 5 && (
          <Button variant="outline" onClick={addStep} className="w-full border-dashed">
            <Plus className="w-4 h-4 mr-1.5" />Add step ({steps.length}/5)
          </Button>
        )}
      </div>

      {/* Settings */}
      <Card><CardContent className="p-5 space-y-4">
        <h3 className="font-semibold text-slate-800">Sender &amp; booking</h3>
        <div>
          <Label className="text-xs text-slate-500">Sender identity</Label>
          <select
            value={senderId}
            disabled={!canEdit}
            onChange={(e) => { setSenderId(e.target.value); setDirty(true); }}
            className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
          >
            <option value="">— select —</option>
            {data.senders?.map((s) => <option key={s.id} value={s.id}>{s.from_name || s.email} &lt;{s.email}&gt;</option>)}
          </select>
          {data.senders?.length === 0 && <p className="text-xs text-slate-400 mt-1">Create a sender in the Resource tab first.</p>}
        </div>
        <div>
          <Label className="text-xs text-slate-500">Booking URL (for {"{{booking_url}}"} merge field)</Label>
          <Input
            value={bookingUrl}
            disabled={!canEdit}
            onChange={(e) => { setBookingUrl(e.target.value); setDirty(true); }}
            className="mt-1.5"
            placeholder="https://calendly.com/your-link"
          />
        </div>
      </CardContent></Card>

      {/* Preview modal */}
      {preview && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <div className="font-semibold text-slate-800">Preview — Step {preview.stepIndex + 1}</div>
              <button onClick={() => setPreview(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="p-4">
              <div className="text-sm font-medium text-slate-700 mb-2">{preview.subject}</div>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <iframe srcDoc={preview.html} className="w-full h-[400px] border-0" title="Email preview" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    draft: "bg-slate-100 text-slate-600",
    ready: "bg-blue-100 text-blue-700",
    active: "bg-emerald-100 text-emerald-700",
    paused: "bg-amber-100 text-amber-700",
    archived: "bg-slate-100 text-slate-400",
  };
  return <span className={`text-xs px-2.5 py-1 rounded-full capitalize ${map[status] || map.draft}`}>{status}</span>;
}