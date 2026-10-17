import React, { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import { MascotBadge } from "@/components/MascotBadge";
import { RooPanel } from "@/components/RooPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { Save, Loader2, Upload } from "lucide-react";

export default function BusinessBrandManager() {
  const { current, refresh } = useWorkspace();
  const [profile, setProfile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!current) return;
    (async () => {
      const res = await base44.functions.invoke("briefAccess", { action: "getBrief", workspace_id: current.id });
      setProfile(res.data?.profile || {});
    })();
  }, [current]);

  const set = (k, v) => setProfile((p) => ({ ...p, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      await base44.functions.invoke("marketingKitAccess", { action: "updateBusinessProfile", workspace_id: current.id, ...profile });
      toast({ title: "Saved" });
    } catch (e) {
      toast({ title: "Save failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function uploadMascot(file) {
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadPublicFile({ file });
      await base44.functions.invoke("workspaceAccess", { action: "updateWorkspace", workspace_id: current.id, mascot_image_url: file_url });
      await refresh();
      toast({ title: "Mascot uploaded" });
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  if (!profile) return <div className="py-8 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold text-slate-800 mb-1">Business basics</h3>
          <p className="text-xs text-slate-500 mb-4">The minimum Roo needs to tailor your funnel content. Everything else is optional.</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Business name"><Input value={profile.business_name || ""} onChange={(e) => set("business_name", e.target.value)} /></Field>
            <Field label="Website (optional)"><Input value={profile.website || ""} onChange={(e) => set("website", e.target.value)} placeholder="https://" /></Field>
          </div>
          <div className="mt-4">
            <Field label="What does your business do?"><Textarea value={profile.primary_service || ""} onChange={(e) => set("primary_service", e.target.value)} rows={2} placeholder="A short description of your product or service" /></Field>
          </div>
          <div className="mt-4">
            <Button disabled={saving} onClick={save}>
              {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold text-slate-800 mb-1">Brand style (optional)</h3>
          <p className="text-xs text-slate-500 mb-4">Add these later — they won't block funnel creation.</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Brand voice"><Input value={profile.brand_voice || ""} onChange={(e) => set("brand_voice", e.target.value)} placeholder="e.g. warm, direct, expert" /></Field>
            <Field label="Contact email"><Input value={profile.contact_email || ""} onChange={(e) => set("contact_email", e.target.value)} /></Field>
            <Field label="Primary color"><Input value={profile.primary_color || ""} onChange={(e) => set("primary_color", e.target.value)} placeholder="#4f46e5" /></Field>
            <Field label="Accent color"><Input value={profile.accent_color || ""} onChange={(e) => set("accent_color", e.target.value)} placeholder="#0ea5e9" /></Field>
          </div>
          <div className="mt-4">
            <Field label="Approved facts (one per line)"><Textarea value={(profile.approved_facts || []).join("\n")} onChange={(e) => set("approved_facts", e.target.value.split("\n").filter(Boolean))} rows={3} placeholder="Only facts you can stand behind. Roo will not invent proof." /></Field>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button variant="outline" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save brand"}</Button>
            <RooPanel title="Suggest an audience" action="draftAudience" onApply={(d) => {
              if (d.name) set("audience_summary", `${d.name}: ${d.roles_industries || ""}`);
            }} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold text-slate-800 mb-1">Roo mascot (optional)</h3>
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