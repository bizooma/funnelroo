import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FileText, CalendarCheck, MessageSquare } from "lucide-react";
import { Reveal } from "./Reveal";
import { useAuth } from "@/lib/AuthContext";

const TEMPLATES = [
  {
    type: "lead_magnet",
    icon: FileText,
    title: "Lead magnet",
    body: "Create a focused page for your guide, checklist, or other useful resource.",
    preview: "Your free guide",
  },
  {
    type: "direct_booking",
    icon: CalendarCheck,
    title: "Demo or consultation",
    body: "Build a clear invitation to explore your product or discuss your services.",
    preview: "Book a discovery call",
  },
  {
    type: "service_inquiry",
    icon: MessageSquare,
    title: "Service inquiry",
    body: "Present your service and help prospective customers understand the next step.",
    preview: "Tell us about your project",
  },
];

export default function Templates() {
  const { isAuthenticated, authChecked } = useAuth();

  const linkFor = (type) => {
    const target = `/funnels?new=1&type=${type}`;
    return authChecked && isAuthenticated
      ? target
      : `/register?returnTo=${encodeURIComponent(target)}`;
  };

  return (
    <section id="templates" className="py-20 md:py-28 bg-white">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal className="max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
            Start with the conversation you want to create.
          </h2>
          <p className="mt-4 text-slate-600">
            Three example templates. Each preview is illustrative — not a live form or booking.
          </p>
        </Reveal>
        <div className="mt-12 grid md:grid-cols-3 gap-6">
          {TEMPLATES.map((t, i) => (
            <Reveal key={t.type} delay={i * 0.05}>
              <div className="h-full flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="bg-slate-50 p-5 border-b border-slate-200">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="text-[10px] uppercase tracking-wide text-indigo-500 font-semibold">{t.preview}</div>
                    <div className="mt-2 h-4 w-3/4 rounded bg-slate-800" />
                    <div className="mt-2 h-2.5 w-full rounded bg-slate-200" />
                    <div className="mt-2 h-2.5 w-1/2 rounded bg-slate-200" />
                    <div className="mt-3 h-7 px-3 rounded-lg bg-indigo-600 text-white text-[11px] flex items-center w-fit font-medium">Continue</div>
                  </div>
                </div>
                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex items-center gap-2">
                    <t.icon className="w-4 h-4 text-indigo-600" />
                    <h3 className="font-semibold text-slate-900">{t.title}</h3>
                  </div>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed flex-1">{t.body}</p>
                  <Button asChild variant="outline" size="sm" className="mt-4 w-full">
                    <Link to={linkFor(t.type)}>Use This Template</Link>
                  </Button>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Button asChild variant="ghost">
            <a href="#templates">Explore Templates</a>
          </Button>
        </div>
      </div>
    </section>
  );
}