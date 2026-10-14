import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { Save, Loader2 } from "lucide-react";

export function FunnelSeoCard({ funnel, onChanged }) {
  const [seoTitle, setSeoTitle] = useState(funnel.seo_title || "");
  const [seoDescription, setSeoDescription] = useState(funnel.seo_description || "");
  const [socialImage, setSocialImage] = useState(funnel.social_image_url || "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await base44.functions.invoke("funnelAccess", {
        action: "update",
        funnel_id: funnel.id,
        seo_title: seoTitle,
        seo_description: seoDescription,
        social_image_url: socialImage,
      });
      toast({ title: "SEO settings saved" });
      onChanged?.();
    } catch (e) {
      toast({ title: "Save failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="font-semibold text-slate-800 mb-1">SEO &amp; social</h3>
        <p className="text-xs text-slate-500 mb-4">
          Controls how your funnel appears in search results and social shares. Leave blank to auto-generate from your page content.
        </p>
        <div className="space-y-4">
          <div>
            <Label className="text-xs text-slate-500">SEO title</Label>
            <Input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} placeholder={`${funnel.name} — Auto from headline`} className="mt-1.5" maxLength={300} />
            <p className="text-xs text-slate-400 mt-1">Shown in browser tabs and search results.</p>
          </div>
          <div>
            <Label className="text-xs text-slate-500">SEO description</Label>
            <Textarea value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} placeholder="Auto from hero subheadline" className="mt-1.5" rows={2} maxLength={500} />
            <p className="text-xs text-slate-400 mt-1">Shown under the title in search results (max ~155 chars used).</p>
          </div>
          <div>
            <Label className="text-xs text-slate-500">Social share image</Label>
            <Input value={socialImage} onChange={(e) => setSocialImage(e.target.value)} placeholder="https://… (falls back to workspace logo)" className="mt-1.5" />
            <p className="text-xs text-slate-400 mt-1">Used for Open Graph and Twitter Card previews. Recommended: 1200×630px.</p>
          </div>
          <Button size="sm" disabled={saving} onClick={save}>
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
            {saving ? "Saving…" : "Save SEO settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}