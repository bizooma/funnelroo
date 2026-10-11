import { MascotBadge } from "@/components/MascotBadge";
import { Reveal } from "./Reveal";

export default function MeetRoo() {
  return (
    <section className="py-20 md:py-28 bg-indigo-50/40">
      <div className="mx-auto max-w-6xl px-5 grid md:grid-cols-2 gap-12 items-center">
        <Reveal>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
            Meet Roo. Your sales funnel sidekick.
          </h2>
          <p className="mt-5 text-lg text-slate-600 leading-relaxed">
            Roo helps you shape your message, organize your funnel, and work through the next step. You bring the business knowledge. Roo helps you turn it into something you can edit, review, and publish.
          </p>
          <p className="mt-4 text-base text-slate-500 italic">
            You stay in control of the message and the final result.
          </p>
        </Reveal>
        <Reveal delay={0.15} className="flex justify-center">
          <div className="relative">
            <div className="w-48 h-48 rounded-full bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center shadow-inner">
              <MascotBadge size={120} />
            </div>
            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-white rounded-full border border-slate-200 shadow-md px-4 py-1.5 text-sm font-medium text-slate-700 whitespace-nowrap">
              Hi, I'm Roo 👋
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}