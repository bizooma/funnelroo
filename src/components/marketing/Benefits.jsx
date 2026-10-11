import { Compass, LayoutTemplate, SlidersHorizontal, Rocket } from "lucide-react";
import { Reveal } from "./Reveal";

const BENEFITS = [
  {
    icon: Compass,
    title: "Start with a plan",
    body: "Use guided setup to shape your audience, offer, and funnel goal before you begin editing.",
  },
  {
    icon: LayoutTemplate,
    title: "Choose your starting point",
    body: "Start with a template for a lead magnet, a demo or consultation, or a service inquiry.",
  },
  {
    icon: SlidersHorizontal,
    title: "Make it your own",
    body: "Edit your message, arrange your page sections, and bring your brand into the experience.",
  },
  {
    icon: Rocket,
    title: "Publish with confidence",
    body: "Review your funnel, address missing setup, and publish a version you can return to later.",
  },
];

export default function Benefits() {
  return (
    <section id="features" className="py-20 md:py-28 bg-white">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal className="max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
            Give your offer a clear path forward.
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Start with your audience and your offer. Build the pages that help visitors understand the value and take the next step.
          </p>
        </Reveal>
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {BENEFITS.map((b, i) => (
            <Reveal key={b.title} delay={i * 0.05}>
              <div className="h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center">
                  <b.icon className="w-5 h-5 text-indigo-600" />
                </div>
                <h3 className="mt-4 font-semibold text-slate-900">{b.title}</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{b.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}