import { Button } from "@/components/ui/button";
import { PrimaryCta } from "./Cta";
import { Reveal } from "./Reveal";
import EditorPreview from "./EditorPreview";

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-indigo-50/50 to-white">
      <div className="mx-auto max-w-6xl px-5 pt-16 pb-20 md:pt-24 md:pb-28 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        <Reveal>
          <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 border border-indigo-100 px-3 py-1 text-xs font-medium text-indigo-700">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
            Your sales funnel sidekick
          </div>
          <h1 className="mt-5 text-4xl md:text-5xl font-bold tracking-tight text-slate-900 leading-[1.1]">
            Your next customer starts with a better funnel.
          </h1>
          <p className="mt-5 text-lg text-slate-600 leading-relaxed max-w-xl">
            Turn your offer into a focused sales funnel with guided setup, AI-assisted content, and pages you can make your own. Roo helps you take it from idea to published.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <PrimaryCta size="lg" />
            <Button asChild variant="outline" size="lg">
              <a href="#how-it-works">See How It Works</a>
            </Button>
          </div>
          <p className="mt-5 text-sm text-slate-400">
            For SaaS founders, consultants, and service businesses.
          </p>
        </Reveal>
        <Reveal delay={0.15} className="relative">
          <EditorPreview />
        </Reveal>
      </div>
    </section>
  );
}