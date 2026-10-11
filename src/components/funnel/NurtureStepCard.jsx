import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Trash2, ArrowUp, ArrowDown, Eye, Send } from "lucide-react";

/** @param {{ step: any; index: number; total: number; onChange: (i: number, field: string, value: any) => void; onRemove: (i: number) => void; onMove: (i: number, dir: number) => void; onPreview: (i: number) => void; onTestSend: (i: number) => void; previewing: number | null; canEdit: boolean }} props */
export function NurtureStepCard({ step, index, total, onChange, onRemove, onMove, onPreview, onTestSend, previewing, canEdit }) {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const delayHours = Number(step.delay_hours || 0);

  return (
    <div className="border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-semibold">
            {index + 1}
          </span>
          <span className="text-sm text-slate-500">
            {isFirst ? "Sent immediately on enrollment" : `${delayHours}h after previous email`}
          </span>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={isFirst} onClick={() => onMove(index, -1)}>
              <ArrowUp className="w-3.5 h-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={isLast} onClick={() => onMove(index, 1)}>
              <ArrowDown className="w-3.5 h-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-500" disabled={total <= 3} onClick={() => onRemove(index)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-slate-500">Subject</Label>
          <Input
            value={step.subject || ""}
            disabled={!canEdit}
            onChange={(e) => onChange(index, "subject", e.target.value)}
            className="mt-1"
            placeholder="Email subject"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Preview text</Label>
          <Input
            value={step.preview || ""}
            disabled={!canEdit}
            onChange={(e) => onChange(index, "preview", e.target.value)}
            className="mt-1"
            placeholder="Short preview shown in inbox"
          />
        </div>
      </div>

      <div>
        <Label className="text-xs text-slate-500">Body (HTML)</Label>
        <Textarea
          value={step.body || ""}
          disabled={!canEdit}
          onChange={(e) => onChange(index, "body", e.target.value)}
          rows={4}
          className="mt-1 font-mono text-xs"
          placeholder="<p>Hi {{first_name}},</p><p>Your message here...</p>"
        />
        <p className="text-[11px] text-slate-400 mt-1">
          Merge fields: {"{{first_name}}"} {"{{business_name}}"} {"{{offer_name}}"} {"{{booking_url}}"} {"{{resource_title}}"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-slate-500">CTA label</Label>
          <Input
            value={step.cta_label || ""}
            disabled={!canEdit}
            onChange={(e) => onChange(index, "cta_label", e.target.value)}
            className="mt-1"
            placeholder="e.g. Book a call"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-500">CTA URL</Label>
          <Input
            value={step.cta_url || ""}
            disabled={!canEdit}
            onChange={(e) => onChange(index, "cta_url", e.target.value)}
            className="mt-1"
            placeholder="https://... or {{booking_url}}"
          />
        </div>
      </div>

      {!isFirst && canEdit && (
        <div>
          <Label className="text-xs text-slate-500">Delay after previous email (hours)</Label>
          <Input
            type="number"
            min={1}
            value={delayHours}
            onChange={(e) => onChange(index, "delay_hours", Number(e.target.value))}
            className="mt-1 w-32"
          />
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" variant="outline" disabled={previewing === index} onClick={() => onPreview(index)}>
          {previewing === index ? "Loading..." : <><Eye className="w-3.5 h-3.5 mr-1" />Preview</>}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onTestSend(index)}>
          <Send className="w-3.5 h-3.5 mr-1" />Send test
        </Button>
      </div>
    </div>
  );
}