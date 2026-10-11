import { MascotBadge } from "@/components/MascotBadge";

// A polished, clearly-illustrative representation of the funnel editor.
// Static sample content only — not a live form or real workspace data.
const SECTIONS = ["Hero", "Benefits", "Form", "Resource", "FAQ", "Footer"];

export default function EditorPreview() {
  return (
    <div className="relative">
      <div className="rounded-2xl border border-slate-200 shadow-2xl shadow-slate-400/30 bg-white overflow-hidden">
        <div className="flex items-center gap-2 px-4 h-10 border-b border-slate-200 bg-slate-50">
          <span className="w-3 h-3 rounded-full bg-rose-300" />
          <span className="w-3 h-3 rounded-full bg-amber-300" />
          <span className="w-3 h-3 rounded-full bg-emerald-300" />
          <div className="ml-3 flex-1 max-w-xs h-6 rounded-md bg-white border border-slate-200 flex items-center px-2.5 text-[11px] text-slate-400">
            funnelroo.app/f/your-discovery-guide
          </div>
        </div>
        <div className="flex">
          <div className="hidden sm:flex flex-col w-44 border-r border-slate-200 bg-slate-50/60 p-3 gap-1">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 px-1 mb-1">Sections</div>
            {SECTIONS.map((s, i) => (
              <div
                key={s}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs ${i === 0 ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-500"}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
                {s}
              </div>
            ))}
          </div>
          <div className="flex-1 p-5 sm:p-6">
            <div className="rounded-xl border border-slate-200 p-5 bg-white">
              <div className="text-[10px] uppercase tracking-wide text-indigo-500 font-semibold">Your free guide</div>
              <div className="mt-2 h-5 w-3/4 rounded bg-slate-800" />
              <div className="mt-2 h-3 w-full rounded bg-slate-200" />
              <div className="mt-1.5 h-3 w-2/3 rounded bg-slate-200" />
              <div className="mt-4 flex gap-2">
                <div className="h-8 px-4 rounded-lg bg-indigo-600 text-white text-xs flex items-center font-medium">Get the guide</div>
                <div className="h-8 w-8 rounded-lg border border-slate-200 bg-slate-50" />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <div className="h-16 rounded-lg bg-slate-100" />
                <div className="h-16 rounded-lg bg-slate-100" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-4 -left-4 hidden sm:flex items-center gap-2 bg-white rounded-2xl border border-slate-200 shadow-lg px-3 py-2">
        <MascotBadge size={36} />
        <div className="pr-1">
          <div className="text-xs font-semibold text-slate-800">Roo</div>
          <div className="text-[10px] text-slate-400">Drafting your page</div>
        </div>
      </div>
    </div>
  );
}