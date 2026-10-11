import { PrimaryCta } from "./Cta";
import { Reveal } from "./Reveal";

export default function FinalCta() {
  return (
    <section className="py-20 md:py-28 bg-slate-900">
      <div className="mx-auto max-w-3xl px-5 text-center">
        <Reveal>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white">
            Give your next offer a place to land.
          </h2>
          <p className="mt-4 text-lg text-slate-300">
            Start building your funnel with Roo.
          </p>
          <div className="mt-8 flex justify-center">
            <PrimaryCta size="lg" />
          </div>
        </Reveal>
      </div>
    </section>
  );
}