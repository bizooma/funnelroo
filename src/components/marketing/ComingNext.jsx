import { Mail, CalendarClock, BarChart3, CreditCard } from "lucide-react";
import { Reveal } from "./Reveal";

const PLANNED = [
  { icon: Mail, title: "Lead capture", body: "Save form submissions as contacts and track where they came from." },
  { icon: CalendarClock, title: "Automated follow-up", body: "Nurture sequences to stay in touch after someone opts in." },
  { icon: CalendarClock, title: "Scheduling integrations", body: "Connect a booking tool so visitors can pick a time directly." },
  { icon: BarChart3, title: "Conversion reporting", body: "See how pages perform and where visitors drop off." },
  { icon: CreditCard, title: "Billing & plans", body: "Choose a plan and manage your subscription when available." },
];

export default function ComingNext() {
  return (
    <section className="py-20 md:py-24 bg-slate-50">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-medium text-amber-700">
            Coming Next
          </div>
          <h2 className="mt-4 text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
            Built for what's next.
          </h2>
          <p className="mt-4 text-slate-600">
            These capabilities are planned and not yet available. They'll be added as they're verified.
          </p>
        </Reveal>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PLANNED.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.04}>
              <div className="h-full rounded-xl border border-dashed border-slate-300 bg-white p-5">
                <div className="flex items-center gap-2 text-slate-400">
                  <p.icon className="w-4 h-4" />
                  <span className="text-[10px] uppercase tracking-wide font-semibold">Planned</span>
                </div>
                <h3 className="mt-3 font-semibold text-slate-800">{p.title}</h3>
                <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}