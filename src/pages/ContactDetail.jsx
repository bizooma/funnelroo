import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { ArrowLeft, Loader2, Mail, FileText, RotateCw, CheckCircle2, XCircle, Clock } from "lucide-react";

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { current, canAdmin } = useWorkspace();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [retrying, setRetrying] = useState(null);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke("contactsAccess", { action: "get", contact_id: id });
      setData(res.data);
      setNotes(res.data?.contact?.notes || "");
    } catch (e) {
      toast({ title: "Could not load contact", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [id]);

  async function saveNotes() {
    setSavingNotes(true);
    try {
      await base44.functions.invoke("contactsAccess", { action: "updateNotes", contact_id: id, notes });
      toast({ title: "Notes saved" });
      await load();
    } catch (e) {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSavingNotes(false);
    }
  }

  async function retry(jobId) {
    setRetrying(jobId);
    try {
      const res = await base44.functions.invoke("contactsAccess", { action: "retryDelivery", job_id: jobId });
      if (res.data?.error) toast({ title: "Retry failed", description: res.data.error, variant: "destructive" });
      else toast({ title: "Delivery retried" });
      await load();
    } catch (e) {
      toast({ title: "Retry failed", variant: "destructive" });
    } finally {
      setRetrying(null);
    }
  }

  if (loading) return <AppShell><div className="p-8"><div className="w-8 h-8 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" /></div></AppShell>;
  if (!data) return <AppShell><div className="p-8 text-sm text-slate-500">Contact not found.</div></AppShell>;

  const c = data.contact;

  return (
    <AppShell>
      <div className="p-8 max-w-4xl">
        <button onClick={() => navigate("/contacts")} className="text-sm text-slate-400 hover:text-slate-600 flex items-center gap-1 mb-4">
          <ArrowLeft className="w-4 h-4" /> All contacts
        </button>

        <div className="flex items-start gap-4 mb-6">
          <div className="w-14 h-14 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xl font-semibold">
            {(c.display_name || c.email).charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-slate-900">{c.display_name || c.email}</h1>
            <p className="text-sm text-slate-500">{c.email}{c.company ? ` · ${c.company}` : ""}{c.phone ? ` · ${c.phone}` : ""}</p>
            <p className="text-xs text-slate-400 mt-1">First seen {new Date(c.created_date).toLocaleDateString()} via {c.first_known_source || "—"}</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {/* Funnels */}
          <Card><CardContent className="p-5">
            <h3 className="font-semibold text-slate-800 mb-3">Funnel participation</h3>
            {(data.leads || []).length === 0 ? <p className="text-sm text-slate-400">No funnels yet.</p> : (
              <div className="space-y-2">
                {data.leads.map((l) => (
                  <div key={l.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{l.funnel_name}</span>
                    <span className="text-xs text-slate-400">{l.last_seen_at ? new Date(l.last_seen_at).toLocaleDateString() : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent></Card>

          {/* Consent */}
          <Card><CardContent className="p-5">
            <h3 className="font-semibold text-slate-800 mb-3">Promotional preferences</h3>
            {(data.consents || []).length === 0 ? <p className="text-sm text-slate-400">No marketing preferences recorded.</p> : (
              <div className="space-y-2">
                {data.consents.map((cn) => (
                  <div key={cn.id} className="text-sm">
                    <span className={cn.choice === "opt_in" ? "text-emerald-600 font-medium" : "text-slate-500"}>{cn.choice === "opt_in" ? "Opted in" : "Opted out"}</span>
                    <p className="text-xs text-slate-400 mt-0.5">{cn.text || "—"} · {new Date(cn.created_date).toLocaleDateString()}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent></Card>
        </div>

        {/* Submissions */}
        <Card className="mt-5"><CardContent className="p-5">
          <h3 className="font-semibold text-slate-800 mb-4">Submissions ({(data.submissions || []).length})</h3>
          {(data.submissions || []).length === 0 ? <p className="text-sm text-slate-400">No submissions.</p> : (
            <div className="space-y-4">
              {data.submissions.map((s) => {
                const grant = (data.grants || []).find((g) => g.submission_id === s.id);
                const jobs = (data.delivery_jobs || []).filter((j) => j.submission_id === s.id);
                return (
                  <div key={s.id} className="border border-slate-100 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-700">{new Date(s.accepted_at).toLocaleString()}</span>
                      <span className="text-xs text-slate-400">Request {s.request_id.slice(0, 8)}…</span>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2 text-sm">
                      {Object.entries(s.answers || {}).map(([k, v]) => (
                        <div key={k} className="text-slate-600"><span className="text-slate-400 capitalize">{k}:</span> {String(v)}</div>
                      ))}
                    </div>
                    {s.consent_choice !== "not_offered" && (
                      <p className="text-xs text-slate-400 mt-2">Consent: {s.consent_choice}</p>
                    )}
                    {grant && (
                      <div className="mt-3 flex items-center gap-2 text-xs">
                        <FileText className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-slate-500">Resource grant {grant.revoked ? "revoked" : grant.accessed_at ? "accessed" : "issued"}</span>
                      </div>
                    )}
                    {jobs.map((j) => (
                      <div key={j.id} className="mt-2 flex items-center gap-2 text-xs">
                        <Mail className="w-3.5 h-3.5 text-slate-400" />
                        <DeliveryState state={j.state} />
                        <span className="text-slate-400">{j.last_error ? `· ${j.last_error}` : ""}</span>
                        {canAdmin && (j.state === "failed" || j.state === "suppressed") && (
                          <Button size="sm" variant="outline" className="h-6 ml-auto" disabled={retrying === j.id} onClick={() => retry(j.id)}>
                            {retrying === j.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3 mr-1" />}Retry
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent></Card>

        {/* Notes */}
        <Card className="mt-5"><CardContent className="p-5">
          <h3 className="font-semibold text-slate-800 mb-3">Staff notes</h3>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Internal notes about this contact…" />
          <Button size="sm" className="mt-3" disabled={savingNotes} onClick={saveNotes}>{savingNotes && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save notes</Button>
        </CardContent></Card>
      </div>
    </AppShell>
  );
}

function DeliveryState({ state }) {
  const map = {
    pending: { icon: Clock, text: "Email queued", color: "text-slate-500" },
    provider_accepted: { icon: CheckCircle2, text: "Email sent", color: "text-emerald-600" },
    delivered: { icon: CheckCircle2, text: "Delivered", color: "text-emerald-600" },
    failed: { icon: XCircle, text: "Email failed", color: "text-rose-600" },
    suppressed: { icon: XCircle, text: "Suppressed", color: "text-amber-600" },
  };
  const m = map[state] || map.pending;
  const Icon = m.icon;
  return <span className={`flex items-center gap-1 ${m.color}`}><Icon className="w-3.5 h-3.5" />{m.text}</span>;
}