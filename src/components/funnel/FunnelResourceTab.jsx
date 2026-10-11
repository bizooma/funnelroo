import React, { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { Loader2, Check, Plus, Mail, Send, AlertTriangle, BadgeCheck } from "lucide-react";

// Resource + delivery configuration for a funnel. Lets the operator attach an
// approved resource version, choose immediate access vs. access + email,
// select/verify a sender, and set optional marketing-consent text.
export function FunnelResourceTab({ funnel, draft, onChanged }) {
  const { current, canAdmin } = useWorkspace();
  const [resources, setResources] = useState([]);
  const [senders, setSenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSender, setShowSender] = useState(false);
  const [senderForm, setSenderForm] = useState({ email: "", from_name: "", reply_to: "" });
  const [testing, setTesting] = useState(null);

  async function load() {
    if (!current) return;
    setLoading(true);
    try {
      const [rRes, sRes] = await Promise.all([
        base44.functions.invoke("resourceAccess", { action: "list", workspace_id: current.id }),
        base44.functions.invoke("senderAccess", { action: "list", workspace_id: current.id }),
      ]);
      setResources(rRes.data?.resources || []);
      setSenders(sRes.data?.senders || []);
    } catch (e) {
      toast({ title: "Could not load delivery config", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [current]);

  async function attach(resourceId, versionId) {
    setSaving(true);
    try {
      await base44.functions.invoke("resourceAccess", { action: "attachToFunnel", resource_id: resourceId, funnel_id: funnel.id, resource_version_id: versionId });
      await onChanged();
      toast({ title: "Resource attached" });
    } catch (e) {
      toast({ title: "Failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function saveDelivery(fields) {
    setSaving(true);
    try {
      await base44.functions.invoke("funnelAccess", { action: "saveDraft", funnel_id: funnel.id, ...fields });
      await onChanged();
    } catch (e) {
      toast({ title: "Failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function createSender() {
    if (!senderForm.email.trim()) return toast({ title: "Sender email required", variant: "destructive" });
    try {
      await base44.functions.invoke("senderAccess", { action: "create", workspace_id: current.id, ...senderForm });
      setSenderForm({ email: "", from_name: "", reply_to: "" });
      setShowSender(false);
      await load();
      toast({ title: "Sender created — verify it with a test send" });
    } catch (e) {
      toast({ title: "Failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    }
  }

  async function testSend(senderId) {
    setTesting(senderId);
    try {
      const res = await base44.functions.invoke("senderAccess", { action: "testSend", workspace_id: current.id, sender_id: senderId });
      if (res.data?.error) toast({ title: "Test send failed", description: res.data.error, variant: "destructive" });
      else toast({ title: "Test sent — check your inbox", description: "Sender verified." });
      await load();
    } catch (e) {
      toast({ title: "Test send failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setTesting(null);
    }
  }

  if (loading) return <div className="p-8"><div className="w-8 h-8 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" /></div>;

  const attachedResourceId = draft?.resource_id || "";
  const deliveryMode = draft?.delivery_mode || "immediate_only";
  const senderId = draft?.sender_id || "";
  const isLeadMagnet = funnel.type === "lead_magnet";

  return (
    <div className="space-y-5">
      {!isLeadMagnet && (
        <Card><CardContent className="p-5 text-sm text-slate-500">
          Resource delivery applies to lead-magnet funnels. {funnel.type === "service_inquiry" ? "Inquiry funnels record submissions and show a receipt." : "Booking funnels keep their existing scheduler link."}
        </CardContent></Card>
      )}

      {isLeadMagnet && (
        <>
          {/* Resource attachment */}
          <Card><CardContent className="p-5">
            <h3 className="font-semibold text-slate-800 mb-1">Resource</h3>
            <p className="text-xs text-slate-500 mb-4">The file or link visitors receive immediately after submitting. A specific version is attached — replacing it later won't change what earlier recipients received.</p>
            {draft?.resource_version_id ? (
              <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <Check className="w-4 h-4 text-emerald-600" />
                <div className="flex-1 text-sm">
                  <div className="font-medium text-slate-800">{resources.find((r) => r.id === attachedResourceId)?.title || "Resource"}</div>
                  <div className="text-xs text-slate-500">Version attached</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => attach(attachedResourceId, "")}>Detach</Button>
              </div>
            ) : (
              <div className="space-y-2">
                {resources.length === 0 && <p className="text-sm text-slate-400">No resources yet. Create one in the Resources page first.</p>}
                {resources.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 border border-slate-200 rounded-lg p-3">
                    <div className="flex-1 text-sm">
                      <div className="font-medium text-slate-800">{r.title}</div>
                      <div className="text-xs text-slate-500">{r.delivery_type === "external" ? "External link" : "File"} · {r.active_version ? `v${r.active_version.version_number}` : "no version"}</div>
                    </div>
                    <Button size="sm" disabled={!r.active_version_id || saving} onClick={() => attach(r.id, r.active_version_id)}>
                      {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />}Attach
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent></Card>

          {/* Delivery mode */}
          <Card><CardContent className="p-5">
            <h3 className="font-semibold text-slate-800 mb-1">Delivery</h3>
            <p className="text-xs text-slate-500 mb-4">Visitors always get immediate on-page access. Optionally also send the resource by email.</p>
            <div className="space-y-2">
              <label className={`flex items-start gap-3 border rounded-lg p-3 cursor-pointer ${deliveryMode === "immediate_only" ? "border-indigo-300 bg-indigo-50/50" : "border-slate-200"}`}>
                <input type="radio" checked={deliveryMode === "immediate_only"} onChange={() => saveDelivery({ delivery_mode: "immediate_only" })} className="mt-1" />
                <div>
                  <div className="text-sm font-medium text-slate-800">Immediate access only</div>
                  <div className="text-xs text-slate-500">Show the resource on the confirmation page. No email sent.</div>
                </div>
              </label>
              <label className={`flex items-start gap-3 border rounded-lg p-3 cursor-pointer ${deliveryMode === "immediate_plus_email" ? "border-indigo-300 bg-indigo-50/50" : "border-slate-200"}`}>
                <input type="radio" checked={deliveryMode === "immediate_plus_email"} onChange={() => saveDelivery({ delivery_mode: "immediate_plus_email" })} className="mt-1" />
                <div>
                  <div className="text-sm font-medium text-slate-800">Immediate access + email</div>
                  <div className="text-xs text-slate-500">Also email the resource link. Requires a verified sender.</div>
                </div>
              </label>
            </div>
          </CardContent></Card>

          {/* Sender */}
          {deliveryMode === "immediate_plus_email" && (
            <Card><CardContent className="p-5">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-slate-800">Sender</h3>
                {canAdmin && <Button size="sm" variant="outline" onClick={() => setShowSender((v) => !v)}><Plus className="w-3.5 h-3.5 mr-1" />New sender</Button>}
              </div>
              <p className="text-xs text-slate-500 mb-4">The verified identity emails are sent from. Test-send to your own inbox to verify.</p>

              {showSender && (
                <div className="border border-slate-200 rounded-lg p-3 mb-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label className="text-xs">Sender email</Label><Input value={senderForm.email} onChange={(e) => setSenderForm({ ...senderForm, email: e.target.value })} /></div>
                    <div><Label className="text-xs">From name</Label><Input value={senderForm.from_name} onChange={(e) => setSenderForm({ ...senderForm, from_name: e.target.value })} /></div>
                  </div>
                  <Button size="sm" onClick={createSender}>Create sender</Button>
                </div>
              )}

              {senders.length === 0 ? (
                <p className="text-sm text-slate-400">No senders yet. Create one and run a test send to verify it.</p>
              ) : (
                <div className="space-y-2">
                  {senders.map((s) => (
                    <div key={s.id} className={`flex items-center gap-3 border rounded-lg p-3 ${senderId === s.id ? "border-indigo-300 bg-indigo-50/50" : "border-slate-200"}`}>
                      <input type="radio" checked={senderId === s.id} onChange={() => saveDelivery({ sender_id: s.id })} />
                      <div className="flex-1 text-sm">
                        <div className="font-medium text-slate-800">{s.from_name || s.email} <span className="text-xs text-slate-400">&lt;{s.email}&gt;</span></div>
                        <div className="text-xs">{s.verified ? <span className="text-emerald-600 flex items-center gap-1"><BadgeCheck className="w-3 h-3" />Verified</span> : <span className="text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Unverified — test send required</span>}</div>
                      </div>
                      {canAdmin && <Button size="sm" variant="outline" disabled={testing === s.id} onClick={() => testSend(s.id)}>{testing === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}Test send</Button>}
                    </div>
                  ))}
                </div>
              )}
              {senders.length > 0 && !senders.find((s) => s.id === senderId)?.verified && (
                <p className="text-xs text-amber-600 mt-3 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />Select a verified sender or run a test send before publishing email delivery.</p>
              )}
            </CardContent></Card>
          )}

          {/* Consent */}
          <Card><CardContent className="p-5">
            <h3 className="font-semibold text-slate-800 mb-1">Marketing consent (optional)</h3>
            <p className="text-xs text-slate-500 mb-3">If added, visitors see an unchecked checkbox. A request never clears an existing unsubscribe.</p>
            <Textarea value={draft?.consent_text || ""} onChange={(e) => saveDelivery({ consent_text: e.target.value })} rows={2} placeholder="e.g. Send me occasional tips and updates." />
          </CardContent></Card>
        </>
      )}
    </div>
  );
}