import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Reveal } from "./Reveal";

const ITEMS = [
  { q: "What is FunnelRoo?", a: "FunnelRoo helps you plan, create, and publish sales funnels with guided setup, editable templates, and assistance from Roo." },
  { q: "Who is FunnelRoo for?", a: "FunnelRoo is designed for SaaS founders, consultants, and service businesses that want a focused way to present an offer and guide visitors toward the next step." },
  { q: "Do I need to know how to code?", a: "You can build your funnel using guided setup and editable page sections." },
  { q: "Can I use my own branding?", a: "Yes. Use your business details, messaging, and available brand settings to make your funnel your own." },
  { q: "Can I change a funnel after publishing?", a: "Yes. Work on a draft and publish the changes when you're ready. Published versions help you manage those updates." },
  { q: "Does FunnelRoo run my advertising?", a: "FunnelRoo does not currently launch or manage ad campaigns. You can use your published funnel as the destination for your marketing." },
];

export default function Faq() {
  return (
    <section id="faq" className="py-20 md:py-28 bg-white">
      <div className="mx-auto max-w-3xl px-5">
        <Reveal>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900 text-center">
            Frequently asked questions
          </h2>
        </Reveal>
        <Reveal delay={0.1} className="mt-10">
          <Accordion type="single" collapsible className="w-full">
            {ITEMS.map((it, i) => (
              <AccordionItem key={i} value={`item-${i}`}>
                <AccordionTrigger className="text-left text-base font-medium text-slate-900">
                  {it.q}
                </AccordionTrigger>
                <AccordionContent className="text-slate-600 leading-relaxed">
                  {it.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </section>
  );
}