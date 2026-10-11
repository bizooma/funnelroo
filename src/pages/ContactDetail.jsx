import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { ArrowLeft, Loader2, Mail, FileText, RotateCw, CheckCircle2, XCircle, Clock, CalendarCheck, Ban } from "lucide-react";

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { current, canAdmin, switchWorkspace, workspaces } = useWorkspace();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [retrying, setRetrying] = useState(null);
  const [marking, setMarking] = useState(null);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke("contactsAccess", { action: "get", contact_id: id });
      const contactWs = res.data?.contact?.workspace_id;
      // Workspace consistency: if the contact belongs to a different workspace,
      // switch to it so the sidebar and context match. Never mix one contact
      // with another workspace's context.
      if (contactWs && current && contactWs !== current.id) {
        const match = workspaces.find((w) => w.id === contactWs);
        if (match) {
          await switchWorkspace(match);
          return; // switchWorkspace triggers context update; this load is stale
        }
      }
      setData(res.data);
      setNotes(res.data?.contact?.notes || "");
    } catch {
      toast({ title: "Could not load contact", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [id, current?.id]);

  async function saveNotes() {
    setSavingNotes(true);
    try {
      await base44.functions.invoke("contactsAccess", { action: "updateNotes", contact_id: id, notes });
      toast({ title: "Notes saved" });
      await load();
    } catch {
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
    } catch {
      toast({ title: "Retry failed", variant: "destructive" });
    } finally {
      setRetrying(null);
    }
  }

  async function markBooked() {
    setMarking("booked");
    try {
      await base44.functions.invoke("nurtureAccess", { action: "markBooked", contact_id: id });
      toast({ title: "Marked as booked", description: "Nurture sequence stopped for this contact." });
      await load();
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    } finally {
      setMarking(null);
    }
  }

  async function markNotInterested() {
    setMarking("not_interested");
    try {
      await base44.functions.invoke("nurtureAccess", { action: "markNotInterested", contact_id: id });
      toast({ title: "Marked as not interested", description: "Nurture sequence stopped for this contact." });
      await load();
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    } finally {
      setMarking(null);
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
            {c.booking_outcome && (
              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full mt-1 ${c.booking_outcome === "booked" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                {c.booking_outcome === "booked" ? <CalendarCheck className="w-3 h-3" /> : <Ban className="w-3 h-3" />}
                {c.booking_outcome === "booked" ? "Marked as booked" : "Not interested"}
              </span>
            )}
          </div>
          {(data.nurture || []).some((e) => e.state === "active") && !c.booking_outcome && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={marking !== null} onClick={markBooked}>
                {marking === "booked" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CalendarCheck className="w-3.5 h-3.5 mr-1" />}Mark booked
              </Button>
              <Button size="sm" variant="outline" disabled={marking !== null} onClick={markNotInterested}>
                {marking === "not_interested" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Ban className="w-3.5 h-3.5 mr-1" />}Not interested
              </Button>
            </div>
          )}
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

        {/* Nurture enrollments */}
        <Card className="mt-5"><CardContent className="p-5">
          <h3 className="font-semibold text-slate-800 mb-3">Nurture sequences</h3>
          {(data.nurture || []).length === 0 ? <p className="text-sm text-slate-400">No nurture enrollments.</p> : (
            <div className="space-y-4">
              {data.nurture.map((e) => (
                <div key={e.id} className="border border-slate-100 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-sm font-medium text-slate-700">{e.sequence_name}</span>
                      <span className={`text-xs ml-2 px-2 py-0.5 rounded-full capitalize ${
                        e.state === "active" ? "bg-emerald-100 text-emerald-700" :
                        e.state === "completed" ? "bg-blue-100 text-blue-700" :
                        e.state === "stopped" ? "bg-slate-100 text-slate-500" :
                        e.state === "suppressed" ? "bg-amber-100 text-amber-700" :
                        "bg-slate-100 text-slate-400"
                      }`}>{e.state}</span>
                    </div>
                    <span className="text-xs text-slate-400">
                      {e.next_due_at && e.state === "active" ? `Next: ${new Date(e.next_due_at).toLocaleString()}` : ""}
                    </span>
                  </div>
                  {e.stop_reason && <p className="text-xs text-slate-400 mb-2">Stopped: {e.stop_reason}</p>}
                  <div className="space-y-1.5">
                    {(e.messages || []).map((m) => (
                      <div key={m.step_index} className="flex items-center gap-2 text-xs">
                        <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-[10px] font-medium">{m.step_index + 1}</span>
                        <span className="text-slate-600 truncate flex-1">{m.subject || "—"}</span>
                        <MessageOutcome outcome={m.outcome} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {(data.suppressions || []).length > 0 && (
            <div className="mt-4 flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-lg p-2.5">
              <Ban className="w-3.5 h-3.5" />
              <span>Suppressed: {data.suppressions.map((s) => s.reason).join(", ")}</span>
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

function MessageOutcome({ outcome }) {
  const map = {
    queued: { text: "Queued", color: "text-slate-400" },
    processing: { text: "Sending...", color: "text-blue-500" },
    provider_accepted: { text: "Sent", color: "text-emerald-600" },
    delivered: { text: "Delivered", color: "text-emerald-600" },
    retryable_failure: { text: "Retry", color: "text-amber-600" },
    permanently_failed: { text: "Failed", color: "text-rose-600" },
    suppressed: { text: "Suppressed", color: "text-amber-600" },
    needs_reconciliation: { text: "Reconcile", color: "text-amber-600" },
  };
  const m = map[outcome] || map.queued;
  return <span className={`text-xs ${m.color}`}>{m.text}</span>;
}