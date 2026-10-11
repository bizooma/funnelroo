import React, { useState } from "react";
import { PageRenderer } from "@/components/funnel/PageRenderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowUp, ArrowDown, Trash2, Plus, Eye, Save, Loader2, GripVertical,
} from "lucide-react";

const BLOCK_TYPES = [
  { type: "hero", label: "Hero" },
  { type: "text", label: "Text" },
  { type: "benefits", label: "Benefits" },
  { type: "image", label: "Image" },
  { type: "testimonial", label: "Testimonial" },
  { type: "faq", label: "FAQ" },
  { type: "video", label: "Video" },
  { type: "form", label: "Form" },
  { type: "resource", label: "Resource" },
  { type: "booking", label: "Booking" },
  { type: "footer", label: "Footer" },
];

function newBlock(type) {
  const id = crypto.randomUUID();
  const base = { id, type, props: {} };
  switch (type) {
    case "hero": base.props = { headline: "", subheadline: "", cta_label: "" }; break;
    case "text": base.props = { heading: "", body: "" }; break;
    case "benefits": base.props = { heading: "", items: [] }; break;
    case "image": base.props = { url: "", alt: "", caption: "" }; break;
    case "testimonial": base.props = { quote: "", author: "", role: "" }; break;
    case "faq": base.props = { heading: "", items: [] }; break;
    case "video": base.props = { url: "", title: "" }; break;
    case "form": base.props = { heading: "", fields: [], submit_label: "Submit" }; break;
    case "resource": base.props = { heading: "", description: "", asset_title: "" }; break;
    case "booking": base.props = { heading: "", calendly_url: "" }; break;
    case "footer": base.props = { text: "", links: [] }; break;
    default: base.props = {};
  }
  return base;
}

export function BlockEditor({ blocks, theme, onSave, saving }) {
  const [local, setLocal] = useState(blocks || []);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const sel = local.find((b) => b.id === selected) || null;

  function update(next) {
    setLocal(next);
    setDirty(true);
  }

  function setProp(key, val) {
    update(local.map((b) => (b.id === selected ? { ...b, props: { ...b.props, [key]: val } } : b)));
  }

  function move(id, dir) {
    const i = local.findIndex((b) => b.id === id);
    const j = i + dir;
    if (j < 0 || j >= local.length) return;
    const next = [...local];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  }

  function remove(id) {
    update(local.filter((b) => b.id !== id));
    if (selected === id) setSelected(null);
  }

  function add(type) {
    const b = newBlock(type);
    update([...local, b]);
    setSelected(b.id);
    setAddOpen(false);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
      {/* Block list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Sections</span>
          <Button size="sm" variant="outline" onClick={() => setPreview(true)}><Eye className="w-3.5 h-3.5 mr-1" /> Preview</Button>
        </div>
        <div className="space-y-1.5">
          {local.map((b, i) => (
            <div
              key={b.id}
              onClick={() => setSelected(b.id)}
              className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${selected === b.id ? "border-indigo-500 bg-indigo-50/50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
            >
              <GripVertical className="w-3.5 h-3.5 text-slate-300" />
              <span className="text-sm font-medium text-slate-700 capitalize flex-1">{b.type}</span>
              <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={(e) => { e.stopPropagation(); move(b.id, -1); }} disabled={i === 0} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                <button onClick={(e) => { e.stopPropagation(); move(b.id, 1); }} disabled={i === local.length - 1} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                <button onClick={(e) => { e.stopPropagation(); remove(b.id); }} className="p-1 text-slate-400 hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
        <div className="relative">
          <Button variant="outline" size="sm" className="w-full" onClick={() => setAddOpen((v) => !v)}><Plus className="w-3.5 h-3.5 mr-1" /> Add section</Button>
          {addOpen && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg p-1 grid grid-cols-2 gap-1">
              {BLOCK_TYPES.map((t) => (
                <button key={t.type} onClick={() => add(t.type)} className="text-left px-2.5 py-1.5 text-sm rounded hover:bg-slate-50 text-slate-700">{t.label}</button>
              ))}
            </div>
          )}
        </div>
        <Button className="w-full mt-3" disabled={!dirty || saving} onClick={() => onSave(local)}>
          {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </Button>
      </div>

      {/* Selected block editor */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 min-h-[400px]">
        {!sel ? (
          <div className="h-full flex items-center justify-center text-sm text-slate-400 py-16">Select a section to edit, or add a new one.</div>
        ) : (
          <PropsEditor block={sel} setProp={setProp} />
        )}
      </div>

      {preview && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPreview(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white/90 backdrop-blur border-b border-slate-100 px-4 py-3 flex items-center justify-between z-10">
              <span className="text-sm font-medium text-slate-700">Live preview</span>
              <Button size="sm" variant="ghost" onClick={() => setPreview(false)}>Close</Button>
            </div>
            <PageRenderer blocks={local} theme={theme} mode="preview" />
          </div>
        </div>
      )}
    </div>
  );
}

function PropsEditor({ block, setProp }) {
  const p = block.props || {};
  const t = block.type;
  const set = (k, v) => setProp(k, v);

  if (t === "hero" || t === "text" || t === "resource" || t === "video" || t === "booking") {
    return (
      <div className="space-y-4">
        {t === "hero" && <Field label="Headline"><Input value={p.headline} onChange={(e) => set("headline", e.target.value)} /></Field>}
        {t === "hero" && <Field label="Subheadline"><Textarea value={p.subheadline} onChange={(e) => set("subheadline", e.target.value)} rows={2} /></Field>}
        {t === "hero" && <Field label="Button label"><Input value={p.cta_label} onChange={(e) => set("cta_label", e.target.value)} /></Field>}
        {(t === "text") && <Field label="Heading"><Input value={p.heading} onChange={(e) => set("heading", e.target.value)} /></Field>}
        {t === "text" && <Field label="Body"><Textarea value={p.body} onChange={(e) => set("body", e.target.value)} rows={6} /></Field>}
        {(t === "resource" || t === "faq") && <Field label="Heading"><Input value={p.heading} onChange={(e) => set("heading", e.target.value)} /></Field>}
        {t === "resource" && <Field label="Description"><Textarea value={p.description} onChange={(e) => set("description", e.target.value)} rows={2} /></Field>}
        {t === "resource" && <Field label="Resource title"><Input value={p.asset_title} onChange={(e) => set("asset_title", e.target.value)} /></Field>}
        {t === "video" && <Field label="Video URL"><Input value={p.url} onChange={(e) => set("url", e.target.value)} /></Field>}
        {t === "video" && <Field label="Title"><Input value={p.title} onChange={(e) => set("title", e.target.value)} /></Field>}
        {t === "booking" && <Field label="Heading"><Input value={p.heading} onChange={(e) => set("heading", e.target.value)} /></Field>}
        {t === "booking" && <Field label="Calendly URL"><Input value={p.calendly_url} onChange={(e) => set("calendly_url", e.target.value)} placeholder="https://calendly.com/…" /></Field>}
      </div>
    );
  }

  if (t === "image") {
    return (
      <div className="space-y-4">
        <Field label="Image URL"><Input value={p.url} onChange={(e) => set("url", e.target.value)} placeholder="https://…" /></Field>
        <Field label="Alt text"><Input value={p.alt} onChange={(e) => set("alt", e.target.value)} /></Field>
        <Field label="Caption"><Input value={p.caption} onChange={(e) => set("caption", e.target.value)} /></Field>
      </div>
    );
  }

  if (t === "testimonial") {
    return (
      <div className="space-y-4">
        <Field label="Quote"><Textarea value={p.quote} onChange={(e) => set("quote", e.target.value)} rows={3} /></Field>
        <Field label="Author"><Input value={p.author} onChange={(e) => set("author", e.target.value)} /></Field>
        <Field label="Role / company"><Input value={p.role} onChange={(e) => set("role", e.target.value)} /></Field>
        <p className="text-xs text-amber-600 bg-amber-50 rounded p-2">Only use real, approved testimonials. Roo will not invent them.</p>
      </div>
    );
  }

  if (t === "benefits") {
    return <ListEditor label="Benefit" items={p.items || []} fields={[{ k: "title", label: "Title" }, { k: "description", label: "Description", area: true }]} heading={p.heading} onHeading={(v) => set("heading", v)} onChange={(items) => set("items", items)} />;
  }
  if (t === "faq") {
    return <ListEditor label="Question" items={p.items || []} fields={[{ k: "question", label: "Question" }, { k: "answer", label: "Answer", area: true }]} heading={p.heading} onHeading={(v) => set("heading", v)} onChange={(items) => set("items", items)} />;
  }
  if (t === "footer") {
    return <ListEditor label="Link" items={p.links || []} fields={[{ k: "label", label: "Label" }, { k: "url", label: "URL" }]} heading={p.text} onHeading={(v) => set("text", v)} headingLabel="Footer text" onChange={(items) => set("links", items)} />;
  }
  if (t === "form") {
    return (
      <div className="space-y-4">
        <Field label="Heading"><Input value={p.heading} onChange={(e) => set("heading", e.target.value)} /></Field>
        <Field label="Submit button label"><Input value={p.submit_label} onChange={(e) => set("submit_label", e.target.value)} /></Field>
        <ListEditor label="Field" items={p.fields || []} fields={[{ k: "name", label: "Name" }, { k: "label", label: "Label" }, { k: "type", label: "Type" }]} onChange={(items) => set("fields", items)} noHeading />
      </div>
    );
  }
  return <div className="text-sm text-slate-400">No editor for this section type.</div>;
}

function Field({ label, children }) {
  return (
    <div>
      <Label className="text-xs text-slate-500">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function ListEditor({ label, items, fields, heading, onHeading, headingLabel, onChange, noHeading }) {
  function update(i, k, v) {
    const next = items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it));
    onChange(next);
  }
  function add() {
    const item = {};
    fields.forEach((f) => (item[f.k] = ""));
    onChange([...items, item]);
  }
  function remove(i) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  return (
    <div className="space-y-3">
      {!noHeading && (
        <Field label={headingLabel || "Heading"}><Input value={heading || ""} onChange={(e) => onHeading(e.target.value)} /></Field>
      )}
      <div className="space-y-2.5">
        {items.map((it, i) => (
          <div key={i} className="border border-slate-200 rounded-lg p-3 space-y-2 relative">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">{label} {i + 1}</span>
              <button onClick={() => remove(i)} className="text-slate-400 hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            {fields.map((f) => (
              <Field key={f.k} label={f.label}>
                {f.area ? <Textarea value={it[f.k] || ""} onChange={(e) => update(i, f.k, e.target.value)} rows={2} /> : <Input value={it[f.k] || ""} onChange={(e) => update(i, f.k, e.target.value)} />}
              </Field>
            ))}
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={add}><Plus className="w-3.5 h-3.5 mr-1" /> Add {label.toLowerCase()}</Button>
    </div>
  );
}