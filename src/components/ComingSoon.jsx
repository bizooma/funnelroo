import React from "react";
import { Construction } from "lucide-react";

export function ComingSoon({ title, description, phase }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
        <Construction className="w-7 h-7 text-amber-500" />
      </div>
      <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
      {description && <p className="text-sm text-slate-500 mt-1.5 max-w-md">{description}</p>}
      {phase && (
        <span className="mt-3 text-[11px] uppercase tracking-wide bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full">
          Planned for {phase}
        </span>
      )}
    </div>
  );
}