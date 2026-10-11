import { Reveal } from "./Reveal";

const STEPS = [
  { n: 1, title: "Tell Roo what you do", body: "Describe your business, your audience, and the offer you want to put in front of them." },
  { n: 2, title: "Pick the next step", body: "Choose the kind of funnel you want to create and start with a layout built around that goal." },
  { n: 3, title: "Shape the experience", body: "Refine the copy, customize the page, and review the details with Roo's help." },
  { n: 4, title: "Publish when you're ready", body: "Complete the launch checks and publish your funnel when you're happy with it." },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 md:py-28 bg-slate-50">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal className="max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
            From “here’s my offer” to “here’s my funnel.”
          </h2>
        </Reveal>
        <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.05}>
              <div className="h-full rounded-2xl bg-white border border-slate-200 p-6 shadow-sm">
                <div className="w-9 h-9 rounded-full bg-indigo-600 text-white flex items-center justify-center font-semibold text-sm">
                  {s.n}
                </div>
                <h3 className="mt-4 font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}