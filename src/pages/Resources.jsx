import React, { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import {
  Loader2, Plus, FileText, Link2, Upload, Archive, X, Paperclip, Check,
} from "lucide-react";

const MAX_FILE_MB = 25;

export default function Resources() {
  const { current } = useWorkspace();
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", delivery_type: "file" });
  const [creating, setCreating] = useState(false);

  async function load() {
    if (!current) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke("resourceAccess", { action: "list", workspace_id: current.id });
      setResources(res.data?.resources || []);
    } catch {
      toast({ title: "Could not load resources", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [current]);

  async function create() {
    if (!form.title.trim()) return toast({ title: "Title is required", variant: "destructive" });
    setCreating(true);
    try {
      await base44.functions.invoke("resourceAccess", { action: "create", workspace_id: current.id, ...form });
      setForm({ title: "", description: "", delivery_type: "file" });
      setShowCreate(false);
      await load();
      toast({ title: "Resource created" });
    } catch (e) {
      toast({ title: "Create failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell>
      <div className="p-8 max-w-5xl">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-slate-900">Resources</h1>
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}><Plus className="w-4 h-4 mr-1" /> New resource</Button>
        </div>
        <p className="text-sm text-slate-500 mb-6">Lead magnets and guides visitors receive after submitting a form. Files are stored privately (stored privately) and delivered through time-limited access links.</p>

        {showCreate && (
          <Card className="mb-6"><CardContent className="p-5 space-y-4">
            <h3 className="font-semibold text-slate-800">Create resource</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-slate-500">Title</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1.5" />
              </div>
              <div>
                <Label className="text-xs text-slate-500">Delivery type</Label>
                <select value={form.delivery_type} onChange={(e) => setForm({ ...form, delivery_type: e.target.value })} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white">
                  <option value="file">File upload (private)</option>
                  <option value="external">External HTTPS link</option>
                </select>
              </div>
            </div>
            <div>
              <Label className="text-xs text-slate-500">Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="mt-1.5" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={creating} onClick={create}>{creating && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Create</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </CardContent></Card>
        )}

        {loading ? (
          <div className="p-8"><div className="w-8 h-8 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" /></div>
        ) : resources.length === 0 ? (
          <Card><CardContent className="p-10 text-center text-sm text-slate-400">No resources yet. Create your first lead magnet.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {resources.map((r) => (
              <ResourceCard key={r.id} resource={r} onChanged={load} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ResourceCard({ resource, onChanged }) {
  const { current } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [extUrl, setExtUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [funnels, setFunnels] = useState([]);
  const [attachFunnel, setAttachFunnel] = useState("");
  const [archiving, setArchiving] = useState(false);

  async function loadFunnels() {
    try {
      const res = await base44.functions.invoke("funnelAccess", { action: "list", workspace_id: current.id });
      setFunnels(res.data?.funnels || []);
    } catch {}
  }

  async function addExternalVersion() {
    if (!extUrl.trim()) return;
    try {
      await base44.functions.invoke("resourceAccess", { action: "createVersion", resource_id: resource.id, delivery_type: "external", external_url: extUrl });
      setExtUrl("");
      await onChanged();
      toast({ title: "New version added" });
    } catch (e) {
      toast({ title: "Failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    }
  }

  async function uploadFile(file) {
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      return toast({ title: `File exceeds ${MAX_FILE_MB}MB limit`, variant: "destructive" });
    }
    setUploading(true);
    try {
      // 1. Upload to private storage (stored privately)
      const up = await base44.integrations.Core.UploadPrivateFile({ file });
      // 2. Register the upload with the server — binds file_uri to this workspace
      const reg = await base44.functions.invoke("resourceAccess", {
        action: "registerUpload",
        workspace_id: current.id,
        file_uri: up.file_uri,
        filename: file.name,
        content_type: file.type || "application/octet-stream",
        size_bytes: file.size,
      });
      // 3. Create the version using the server-authorized upload_id (not raw file_uri)
      await base44.functions.invoke("resourceAccess", {
        action: "createVersion",
        resource_id: resource.id,
        delivery_type: "file",
        upload_id: reg.data?.upload_id,
      });
      await onChanged();
      toast({ title: "New version uploaded" });
    } catch (e) {
      toast({ title: "Upload failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function attach() {
    if (!attachFunnel) return;
    try {
      await base44.functions.invoke("resourceAccess", { action: "attachToFunnel", resource_id: resource.id, funnel_id: attachFunnel });
      toast({ title: "Attached to funnel" });
      setAttachFunnel("");
    } catch (e) {
      toast({ title: "Failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    }
  }

  async function archive() {
    setArchiving(true);
    try {
      await base44.functions.invoke("resourceAccess", { action: "update", resource_id: resource.id, archived: true });
      await onChanged();
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    } finally {
      setArchiving(false);
    }
  }

  const av = resource.active_version;
  const Icon = resource.delivery_type === "external" ? Link2 : FileText;

  return (
    <Card><CardContent className="p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-800 truncate">{resource.title}</h3>
            {av && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">v{av.version_number} active</span>}
            {resource.delivery_type === "external" && <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">external</span>}
          </div>
          {resource.description && <p className="text-sm text-slate-500 mt-0.5 line-clamp-1">{resource.description}</p>}
          {av?.filename && <p className="text-xs text-slate-400 mt-1 flex items-center gap-1"><Paperclip className="w-3 h-3" />{av.filename}</p>}
          {av?.external_url && <p className="text-xs text-slate-400 mt-1 truncate">{av.external_url}</p>}
        </div>
        <Button size="sm" variant="outline" onClick={() => { setOpen((v) => !v); if (!open) loadFunnels(); }}>{open ? <X className="w-3.5 h-3.5 mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />}{open ? "Close" : "Manage"}</Button>
      </div>

      {open && (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
          {/* Add version */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Add new version</p>
            {resource.delivery_type === "external" ? (
              <div className="flex gap-2">
                <Input value={extUrl} onChange={(e) => setExtUrl(e.target.value)} placeholder="https://…" />
                <Button size="sm" onClick={addExternalVersion}>Add link</Button>
              </div>
            ) : (
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-300 cursor-pointer hover:bg-slate-50 text-sm text-slate-600 w-fit">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? "Uploading…" : "Upload file (stored privately)"}
                <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])} />
              </label>
            )}
            <p className="text-xs text-slate-400 mt-1">Max {MAX_FILE_MB}MB. PDF, images, docs, sheets, slides, text. New versions don't change what earlier recipients already received.</p>
          </div>

          {/* Attach to funnel */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Attach to funnel</p>
            <div className="flex gap-2">
              <select value={attachFunnel} onChange={(e) => setAttachFunnel(e.target.value)} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white">
                <option value="">— select funnel —</option>
                {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <Button size="sm" variant="outline" onClick={attach}><Check className="w-3.5 h-3.5 mr-1" />Attach</Button>
            </div>
          </div>

          <Button size="sm" variant="ghost" onClick={archive} disabled={archiving} className="text-slate-400"><Archive className="w-3.5 h-3.5 mr-1" />Archive resource</Button>
        </div>
      )}
    </CardContent></Card>
  );
}