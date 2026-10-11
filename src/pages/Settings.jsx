import React, { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import AppShell from "@/components/AppShell";
import { MascotBadge } from "@/components/MascotBadge";
import { ComingSoon } from "@/components/ComingSoon";
import { RooPanel } from "@/components/RooPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import {
  Save, Loader2, Plus, Trash2, Upload, Users, FileText, CreditCard, Plug, Shield, Copy, Check,
} from "lucide-react";
import CalendlyTab from "@/components/settings/CalendlyTab";

const TABS = [
  { id: "brief", label: "Business brief", icon: FileText },
  { id: "team", label: "Team", icon: Users },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "billing", label: "Billing", icon: CreditCard, soon: true },
  { id: "data", label: "Data controls", icon: Shield, soon: true },
];

export default function Settings() {
  const { current, loading, canAdmin } = useWorkspace();
  const [tab, setTab] = useState("brief");

  if (loading) return <AppShell><div className="p-8"><div className="w-8 h-8 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" /></div></AppShell>;
  if (!current) return null;

  return (
    <AppShell>
      <div className="p-8 max-w-4xl">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Settings</h1>
        <p className="text-sm text-slate-500 mb-6">Manage your business brief, team and workspace.</p>

        <div className="flex items-center gap-1 border-b border-slate-200 mb-6">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${tab === t.id ? "text-indigo-600" : "text-slate-500 hover:text-slate-700"}`}>
              {t.label}
              {t.soon && <span className="ml-1.5 text-[9px] uppercase bg-slate-100 text-slate-400 px-1 py-0.5 rounded">Soon</span>}
              {tab === t.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />}
            </button>
          ))}
        </div>

        {tab === "brief" && <BriefTab />}
        {tab === "team" && <TeamTab canAdmin={canAdmin} />}
        {tab === "integrations" && <CalendlyTab />}
        {tab === "billing" && <Card><CardContent><ComingSoon title="Billing" description="Stripe subscriptions — one per workspace — with owner-only controls and server-side entitlements." phase="Follow-on Phase 4" /></CardContent></Card>}
        {tab === "data" && <Card><CardContent><ComingSoon title="Data controls" description="Export and deletion handling, retention policy and audit records." phase="Follow-on Phase 3-4" /></CardContent></Card>}
      </div>
    </AppShell>
  );
}

function BriefTab() {
  const { current, refresh } = useWorkspace();
  const [profile, setProfile] = useState(null);
  const [audiences, setAudiences] = useState([]);
  const [offers, setOffers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function load() {
    const res = await base44.functions.invoke("briefAccess", { action: "getBrief", workspace_id: current.id });
    setProfile(res.data?.profile || {});
    setAudiences(res.data?.audiences || []);
    setOffers(res.data?.offers || []);
  }
  useEffect(() => { load(); }, [current]);

  const set = (k, v) => setProfile((p) => ({ ...p, [k]: v }));

  async function saveProfile() {
    setSaving(true);
    try {
      await base44.functions.invoke("briefAccess", { action: "updateBusinessProfile", workspace_id: current.id, ...profile });
      toast({ title: "Brief saved" });
    } catch (e) {
      toast({ title: "Save failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function uploadMascot(file) {
    setUploading(true);
    try {
      const { file_url } = await /** @type {any} */(base44.integrations.Core).UploadPublicFile({ file });
      await base44.functions.invoke("workspaceAccess", { action: "updateWorkspace", workspace_id: current.id, mascot_image_url: file_url });
      await refresh();
      toast({ title: "Mascot uploaded" });
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Mascot */}
      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold text-slate-800 mb-1">Roo mascot</h3>
          <p className="text-xs text-slate-500 mb-4">Upload your approved mascot image. It appears in the workspace and contextual help.</p>
          <div className="flex items-center gap-4">
            <MascotBadge size={56} src={current?.mascot_image_url} />
            <label className="cursor-pointer">
              <span className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? "Uploading…" : "Upload image"}
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && uploadMascot(e.target.files[0])} />
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Business profile */}
      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold text-slate-800 mb-4">Business profile</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Business name"><Input value={profile?.business_name || ""} onChange={(e) => set("business_name", e.target.value)} /></Field>
            <Field label="Website"><Input value={profile?.website || ""} onChange={(e) => set("website", e.target.value)} /></Field>
            <Field label="Primary service"><Input value={profile?.primary_service || ""} onChange={(e) => set("primary_service", e.target.value)} /></Field>
            <Field label="Brand voice"><Input value={profile?.brand_voice || ""} onChange={(e) => set("brand_voice", e.target.value)} /></Field>
            <Field label="Contact email"><Input value={profile?.contact_email || ""} onChange={(e) => set("contact_email", e.target.value)} /></Field>
            <Field label="Primary color"><Input value={profile?.primary_color || ""} onChange={(e) => set("primary_color", e.target.value)} placeholder="#4f46e5" /></Field>
          </div>
          <div className="grid grid-cols-1 gap-4 mt-4">
            <Field label="Audience summary"><Textarea value={profile?.audience_summary || ""} onChange={(e) => set("audience_summary", e.target.value)} rows={2} /></Field>
            <Field label="Offer summary"><Textarea value={profile?.offer_summary || ""} onChange={(e) => set("offer_summary", e.target.value)} rows={2} /></Field>
            <Field label="Approved facts (one per line)"><Textarea value={(profile?.approved_facts || []).join("\n")} onChange={(e) => set("approved_facts", e.target.value.split("\n").filter(Boolean))} rows={3} /></Field>
          </div>
          <div className="flex items-center gap-2 mt-5">
            <Button disabled={saving} onClick={saveProfile}>{saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />} {saving ? "Saving…" : "Save brief"}</Button>
            <RooPanel title="Suggest an audience" action="draftAudience" onApply={(d) => {
              if (d.name) setAudiences((a) => [...a, { id: "", name: d.name, roles_industries: d.roles_industries, problems: d.problems, objections: d.objections, desired_outcomes: d.desired_outcomes, alternatives: d.alternatives, approved: false, ai_suggested: true }]);
            }} />
          </div>
        </CardContent>
      </Card>

      {/* Audiences */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800">Audiences</h3>
            <Button size="sm" variant="outline" onClick={() => setAudiences((a) => [...a, { id: "", name: "New audience", problems: [], objections: [], desired_outcomes: [], alternatives: [], approved: false }])}><Plus className="w-3.5 h-3.5 mr-1" /> Add</Button>
          </div>
          <div className="space-y-2">
            {audiences.map((a, i) => (
              <div key={a.id || i} className="border border-slate-200 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <Input value={a.name} onChange={(e) => { const n = [...audiences]; n[i] = { ...a, name: e.target.value }; setAudiences(n); }} className="font-medium" />
                  <Button size="sm" variant="ghost" onClick={async () => { await base44.functions.invoke("briefAccess", { action: "saveAudience", workspace_id: current.id, ...a }); toast({ title: "Saved" }); load(); }}><Save className="w-3.5 h-3.5" /></Button>
                  {a.id && <Button size="sm" variant="ghost" onClick={async () => { await base44.functions.invoke("briefAccess", { action: "deleteAudience", workspace_id: current.id, id: a.id }); load(); }}><Trash2 className="w-3.5 h-3.5 text-rose-500" /></Button>}
                </div>
                {a.ai_suggested && <span className="text-[10px] uppercase bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded mt-1 inline-block">AI suggestion</span>}
              </div>
            ))}
            {audiences.length === 0 && <p className="text-sm text-slate-400">No audiences yet.</p>}
          </div>
        </CardContent>
      </Card>

      {/* Offers */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800">Offers</h3>
            <Button size="sm" variant="outline" onClick={() => setOffers((o) => [...o, { id: "", name: "New offer", offer: "", goal: "lead_magnet", cta: "", supporting_proof: [], approved: false }])}><Plus className="w-3.5 h-3.5 mr-1" /> Add</Button>
          </div>
          <div className="space-y-2">
            {offers.map((o, i) => (
              <div key={o.id || i} className="border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input value={o.name} onChange={(e) => { const n = [...offers]; n[i] = { ...o, name: e.target.value }; setOffers(n); }} className="font-medium" />
                  <select value={o.goal} onChange={(e) => { const n = [...offers]; n[i] = { ...o, goal: e.target.value }; setOffers(n); }} className="rounded-lg border border-slate-200 px-2 py-2 text-sm">
                    <option value="lead_magnet">Lead magnet</option>
                    <option value="direct_booking">Direct booking</option>
                    <option value="service_inquiry">Service inquiry</option>
                  </select>
                  <Button size="sm" variant="ghost" onClick={async () => { await base44.functions.invoke("briefAccess", { action: "saveOffer", workspace_id: current.id, ...o }); toast({ title: "Saved" }); load(); }}><Save className="w-3.5 h-3.5" /></Button>
                  {o.id && <Button size="sm" variant="ghost" onClick={async () => { await base44.functions.invoke("briefAccess", { action: "deleteOffer", workspace_id: current.id, id: o.id }); load(); }}><Trash2 className="w-3.5 h-3.5 text-rose-500" /></Button>}
                </div>
                <Input value={o.offer} placeholder="Offer description" onChange={(e) => { const n = [...offers]; n[i] = { ...o, offer: e.target.value }; setOffers(n); }} />
                <Input value={o.cta} placeholder="Call to action" onChange={(e) => { const n = [...offers]; n[i] = { ...o, cta: e.target.value }; setOffers(n); }} />
              </div>
            ))}
            {offers.length === 0 && <p className="text-sm text-slate-400">No offers yet.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TeamTab({ canAdmin }) {
  const { current } = useWorkspace();
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [sending, setSending] = useState(false);
  const [lastInvite, setLastInvite] = useState(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    const [m, i] = await Promise.all([
      base44.functions.invoke("workspaceAccess", { action: "listMembers", workspace_id: current.id }),
      base44.functions.invoke("workspaceAccess", { action: "listInvites", workspace_id: current.id }),
    ]);
    setMembers(m.data?.members || []);
    setInvites(i.data?.invites || []);
  }
  useEffect(() => { load(); }, [current]);

  async function invite() {
    setSending(true);
    setLastInvite(null);
    try {
      const res = await base44.functions.invoke("workspaceAccess", { action: "invite", workspace_id: current.id, email, role });
      const link = res.data?.invite_link || "";
      setLastInvite({ email, link, email_sent: res.data?.email_sent, error: res.data?.email_error });
      setEmail("");
      if (res.data?.email_sent) {
        toast({ title: "Invitation created", description: `Sent to ${lastInvite?.email || email}.` });
      } else {
        toast({ title: "Invitation created", description: "Email could not be sent automatically. Copy the link below to share it." });
      }
      load();
    } catch (e) {
      toast({ title: "Invite failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  function copyLink(link) {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function remove(memberId) {
    if (!confirm("Remove this member?")) return;
    try {
      await base44.functions.invoke("workspaceAccess", { action: "removeMember", workspace_id: current.id, member_id: memberId });
      load();
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold text-slate-800 mb-1">Members</h3>
          <p className="text-xs text-slate-500 mb-4">Roles: Owner (billing & ownership), Admin (publish & manage), Member (edit drafts & contacts).</p>
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between border border-slate-200 rounded-lg p-3">
                <div>
                  <div className="text-sm font-medium text-slate-800">{m.user_name || m.user_email}</div>
                  <div className="text-xs text-slate-400">{m.user_email}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 capitalize">{m.role}</span>
                  {canAdmin && m.role !== "owner" && <Button size="sm" variant="ghost" onClick={() => remove(m.id)}><Trash2 className="w-3.5 h-3.5 text-rose-500" /></Button>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {canAdmin && (
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold text-slate-800 mb-4">Invite a member</h3>
            <div className="flex items-center gap-2">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" className="max-w-xs" />
              <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <Button disabled={!email || sending} onClick={invite}>{sending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null} {sending ? "Sending…" : "Send invite"}</Button>
            </div>
            {lastInvite && (
              <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span className="font-medium">Invitation created</span>
                  {lastInvite.email_sent
                    ? <span className="text-slate-500">— sent to {lastInvite.email}</span>
                    : <span className="text-amber-600">— email could not be sent automatically</span>}
                </div>
                {!lastInvite.email_sent && lastInvite.link && (
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 text-xs bg-white border border-slate-200 rounded px-2 py-1.5 truncate">{lastInvite.link}</code>
                    <Button size="sm" variant="outline" onClick={() => copyLink(lastInvite.link)}>
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                )}
              </div>
            )}
            {invites.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-slate-500 mb-2">Pending invites</p>
                {invites.map((iv) => (
                  <div key={iv.id} className="flex items-center justify-between text-sm py-1.5">
                    <span className="text-slate-600">{iv.email} <span className="text-slate-400">· {iv.role}</span></span>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="ghost" className="h-6" onClick={() => copyLink(`${window.location.origin}/accept-invite?token=${encodeURIComponent(iv.token)}`)}>
                        {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      </Button>
                      <span className="text-xs text-amber-600">Pending</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
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