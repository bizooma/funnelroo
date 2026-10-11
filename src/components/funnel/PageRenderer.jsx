import React from "react";
import { Image } from "@/components/ui/image";
import { Calendar, FileText, HelpCircle, Quote, Video } from "lucide-react";
import { PublicForm } from "./PublicForm";

// Shared section-based page renderer. Renders the same structured page_blocks
// in the editor preview and on the anonymous public funnel page.
// mode: "preview" (editor) | "public" (live).

// Parse a video URL into an embeddable iframe src. Supports YouTube and Vimeo.
// Returns null for unsupported/empty URLs.
function videoEmbedSrc(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    // YouTube: youtube.com/watch?v=, youtu.be/
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
    }
    if (host === "youtu.be") {
      return `https://www.youtube.com/embed${u.pathname}`;
    }
    // Vimeo: vimeo.com/ID
    if (host === "vimeo.com") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
    return null;
  } catch {
    return null;
  }
}

function scrollToCtaTarget() {
  const el = document.getElementById("funnel-form") || document.getElementById("funnel-booking");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Block({ block, theme, mode, onSubmit, formState }) {
  const p = block.props || {};
  const primary = theme?.primary_color || "#4f46e5";
  switch (block.type) {
    case "hero":
      return (
        <section className="px-6 py-16 text-center max-w-3xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-bold text-slate-900 tracking-tight leading-tight">
            {p.headline || (mode === "preview" ? "Your headline appears here" : "")}
          </h1>
          {p.subheadline && <p className="mt-5 text-lg text-slate-600 leading-relaxed">{p.subheadline}</p>}
          {p.cta_label && (
            <button
              onClick={scrollToCtaTarget}
              className="mt-8 px-7 py-3 rounded-lg text-white font-medium text-sm shadow-sm"
              style={{ background: primary }}
            >
              {p.cta_label}
            </button>
          )}
        </section>
      );
    case "text":
      return (
        <section className="px-6 py-10 max-w-2xl mx-auto">
          {p.heading && <h2 className="text-2xl font-semibold text-slate-900 mb-3">{p.heading}</h2>}
          {p.body && <div className="text-slate-600 leading-relaxed whitespace-pre-line">{p.body}</div>}
        </section>
      );
    case "benefits":
      return (
        <section className="px-6 py-12 max-w-4xl mx-auto">
          {p.heading && <h2 className="text-2xl font-semibold text-slate-900 text-center mb-8">{p.heading}</h2>}
          <div className="grid md:grid-cols-3 gap-6">
            {(p.items || []).map((item, i) => (
              <div key={i} className="text-center">
                <div className="w-10 h-10 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: `${primary}15`, color: primary }}>
                  <span className="font-semibold">{i + 1}</span>
                </div>
                <h3 className="font-semibold text-slate-800 mb-1.5">{item.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </section>
      );
    case "image":
      return (
        <section className="px-6 py-8 max-w-3xl mx-auto">
          {p.url && (
            <div className="rounded-xl overflow-hidden">
              <Image src={p.url} alt={p.alt || ""} fittingType="fit" className="w-full" />
            </div>
          )}
          {p.caption && <p className="text-center text-sm text-slate-400 mt-2">{p.caption}</p>}
        </section>
      );
    case "testimonial":
      return (
        <section className="px-6 py-12 max-w-2xl mx-auto">
          <div className="bg-slate-50 rounded-2xl p-8 border border-slate-100">
            <Quote className="w-6 h-6 mb-3" style={{ color: primary }} />
            <p className="text-lg text-slate-700 leading-relaxed italic">"{p.quote}"</p>
            <div className="mt-4 text-sm">
              <span className="font-semibold text-slate-800">{p.author}</span>
              {p.role && <span className="text-slate-400"> · {p.role}</span>}
            </div>
          </div>
        </section>
      );
    case "faq":
      return (
        <section className="px-6 py-10 max-w-2xl mx-auto">
          {p.heading && <h2 className="text-2xl font-semibold text-slate-900 mb-6">{p.heading}</h2>}
          <div className="space-y-4">
            {(p.items || []).map((item, i) => (
              <div key={i} className="border-b border-slate-100 pb-4">
                <div className="flex items-start gap-2 font-medium text-slate-800 mb-1.5">
                  <HelpCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: primary }} />
                  {item.question}
                </div>
                <p className="text-sm text-slate-500 leading-relaxed pl-6">{item.answer}</p>
              </div>
            ))}
          </div>
        </section>
      );
    case "video": {
      const embedSrc = videoEmbedSrc(p.url);
      return (
        <section className="px-6 py-8 max-w-3xl mx-auto">
          {embedSrc ? (
            <div className="rounded-xl overflow-hidden aspect-video bg-black">
              <iframe
                src={embedSrc}
                title={p.title || "Video"}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-10 text-center">
              <Video className="w-10 h-10 mx-auto text-slate-300" />
              {p.title && <p className="mt-3 text-sm text-slate-500">{p.title}</p>}
              <p className="text-xs text-slate-400 mt-1">
                {p.url ? "Unsupported video URL. Use a YouTube or Vimeo link." : "No video URL set. Add a YouTube or Vimeo link in the editor."}
              </p>
            </div>
          )}
        </section>
      );
    }
    case "form":
      if (mode === "public" && onSubmit) {
        return (
          <section id="funnel-form" className="px-6 py-10 max-w-md mx-auto">
            <PublicForm
              heading={p.heading}
              fields={p.fields || []}
              submitLabel={p.submit_label}
              primary={primary}
              onSubmit={onSubmit}
              formState={formState}
            />
          </section>
        );
      }
      return (
        <section id="funnel-form" className="px-6 py-10 max-w-md mx-auto">
          <div className="bg-white rounded-2xl border border-slate-200 p-7 shadow-sm">
            {p.heading && <h2 className="text-xl font-semibold text-slate-900 mb-4">{p.heading}</h2>}
            <div className="space-y-3">
              {(p.fields || []).map((f, i) => (
                <div key={i}>
                  <label className="text-xs font-medium text-slate-600">{f.label}{f.required && <span className="text-rose-500"> *</span>}</label>
                  {f.type === "textarea" ? (
                    <textarea disabled className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-slate-50" rows={3} />
                  ) : (
                    <input disabled type={f.type || "text"} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-slate-50" />
                  )}
                </div>
              ))}
            </div>
            <button disabled className="mt-4 w-full py-2.5 rounded-lg text-white text-sm font-medium" style={{ background: primary }}>
              {p.submit_label || "Submit"}
            </button>
          </div>
        </section>
      );
    case "resource":
      return (
        <section className="px-6 py-8 max-w-2xl mx-auto">
          <div className="flex items-start gap-4 bg-indigo-50 rounded-xl p-5">
            <div className="w-11 h-11 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              {p.heading && <h3 className="font-semibold text-slate-800">{p.heading}</h3>}
              {p.description && <p className="text-sm text-slate-500 mt-1">{p.description}</p>}
              {p.asset_title && <p className="text-xs text-slate-400 mt-1.5">Resource: {p.asset_title}</p>}
            </div>
          </div>
        </section>
      );
    case "booking":
      return (
        <section id="funnel-booking" className="px-6 py-10 max-w-md mx-auto text-center">
          <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center mb-3" style={{ background: `${primary}15`, color: primary }}>
            <Calendar className="w-6 h-6" />
          </div>
          {p.heading && <h2 className="text-xl font-semibold text-slate-900 mb-1">{p.heading}</h2>}
          {p.calendly_url && mode === "public" ? (
            <a href={p.calendly_url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block px-6 py-2.5 rounded-lg text-white text-sm font-medium" style={{ background: primary }}>
              Book a time
            </a>
          ) : (
            <p className="text-sm text-slate-400 mt-2">{p.calendly_url ? "Scheduler connected" : "Add a scheduler link in the editor"}</p>
          )}
        </section>
      );
    case "footer":
      return (
        <footer className="px-6 py-8 border-t border-slate-100 mt-8">
          <div className="max-w-3xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
            {p.text && <p className="text-xs text-slate-400">{p.text}</p>}
            <div className="flex gap-4">
              {(p.links || []).map((l, i) => (
                <a key={i} href={l.url} className="text-xs text-slate-400 hover:text-slate-600">{l.label}</a>
              ))}
            </div>
          </div>
        </footer>
      );
    default:
      return null;
  }
}

export function PageRenderer({ blocks = [], theme, mode = "preview", onSubmit, formState }) {
  return (
    <div className="bg-white min-h-full">
      {(blocks || []).map((block) => (
        <Block key={block.id} block={block} theme={theme} mode={mode} onSubmit={onSubmit} formState={formState} />
      ))}
    </div>
  );
}