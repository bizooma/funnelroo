import React, { forwardRef } from "react";

// PersonaCard: a reusable, export-oriented presentation component.
// It renders a one-page persona reference from audience + persona metadata.
// Editing controls and app navigation live OUTSIDE this component.

const DEFAULT_ACCENT = "#FFB800"; // Classic Amber

function readAccent(meta) {
  const a = meta?.theme?.accent || meta?.accent_color;
  if (a && /^#[0-9a-fA-F]{3,8}$/.test(a)) return a;
  return DEFAULT_ACCENT;
}

// Pick dark or light text for sufficient contrast on the accent band.
function textOn(hex) {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? "#111111" : "#ffffff";
}

const RATING_LABELS = { 1: "Lower", 2: "Lower", 3: "Moderate", 4: "Higher", 5: "Higher" };

function PersonaCard({ data, meta, exportLayout }, ref) {
  const accent = readAccent(meta);
  const onAccent = textOn(accent);
  const title = data.title || meta.name || "Audience archetype";
  const subtitle = data.subtitle || meta.rolesIndustries;

  const facts = data.facts || [];
  const hasQuote = data.quote?.text;
  const hasPortrait = data.portrait?.url;
  const motivations = (data.motivations || []).filter((m) => m.label);
  const buyingStyle = (data.buyingStyle || []).filter((b) => b.left && b.right && b.position != null);
  const messagingGuidance = (data.messagingGuidance || []).filter((g) => g.text);
  const goals = data.goals || [];
  const frustrations = data.frustrations || [];
  const objections = data.objections || [];
  const alternatives = data.alternatives || [];
  const bio = data.bio;

  // Export-layout configuration: when there is no purchasing-motivations section,
  // the center column has room beneath Bio, so messaging guidance moves there
  // instead of crowding the narrower right column. On-screen (exportLayout off)
  // keeps the original right-column assignment.
  const messagingInCenter = exportLayout && motivations.length === 0;
  const hasRight = goals.length || frustrations.length || objections.length || alternatives.length || buyingStyle.length || (messagingGuidance.length && !messagingInCenter);

  const messagingBlock = messagingGuidance.length > 0 && (
    <div>
      <SectionLabel>Messaging guidance</SectionLabel>
      {meta.messagingAiSuggested && (
        <div className="mt-1 uppercase tracking-wide text-amber-600" style={{ fontSize: "var(--pc-caption, 10px)" }}>Suggested by Roo</div>
      )}
      <div className="mt-1.5 space-y-1.5">
        {messagingGuidance.map((g, i) => (
          <div key={i} style={{ fontSize: "var(--pc-body, 12px)" }}>
            {g.heading && <span className="font-semibold text-slate-800">{g.heading}: </span>}
            <span className="text-slate-700">{g.text}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div
      ref={ref}
      className="persona-card bg-white text-slate-900 mx-auto"
      style={{ width: "100%", maxWidth: "1100px", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
    >
      {/* HEADER */}
      <div
        className="flex items-end justify-between px-10 py-7"
        style={{ background: accent, color: onAccent }}
      >
        <div className="min-w-0 pr-6">
          <div
            className="font-bold leading-[1.05] tracking-tight"
            style={{ fontSize: "38px", fontFamily: "ui-serif, Georgia, serif" }}
          >
            {title}
          </div>
          {subtitle && (
            <div className="mt-1 opacity-90" style={{ fontSize: "15px" }}>
              {subtitle}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-center justify-end gap-2">
            {meta.logoUrl && (
              <img src={meta.logoUrl} alt="" className="h-7 w-auto object-contain" style={{ filter: onAccent === "#ffffff" ? "brightness(0) invert(1)" : "none" }} />
            )}
            <span className="font-semibold" style={{ fontSize: "15px" }}>{meta.businessName || "Your business"}</span>
          </div>
          <div className="mt-1.5 h-px w-full" style={{ background: onAccent, opacity: 0.3 }} />
          <div className="mt-1.5 uppercase tracking-[0.18em] font-medium" style={{ fontSize: "var(--pc-caption, 11px)", opacity: 0.85 }}>
            Persona Card
          </div>
        </div>
      </div>

      {/* BODY: 3 columns */}
      <div className={`px-10 py-8 grid gap-7 persona-grid ${hasRight ? "persona-grid-3" : "persona-grid-2"}`}>
        {/* LEFT */}
        <div className="persona-col-left space-y-4">
          {facts.length > 0 && (
            <div>
              <SectionLabel>Who they are</SectionLabel>
              <div className="mt-1.5 space-y-1">
                {facts.map((f) => (
                  <div key={f.label} className="flex gap-2" style={{ fontSize: "var(--pc-body, 13px)" }}>
                    <span className="font-semibold text-slate-700 min-w-[90px]">{f.label}:</span>
                    <span className="text-slate-600">{f.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Portrait url={hasPortrait ? data.portrait.url : null} credit={data.portrait?.credit} origin={data.portrait?.origin} alt={data.portrait?.alt} accent={accent} initials={data.initials} />

          {hasQuote && (
            <div className="p-4" style={{ background: accent }}>
              <p className="italic text-slate-900" style={{ fontSize: "14px", fontFamily: "ui-serif, Georgia, serif", lineHeight: 1.45 }}>
                “{data.quote.text}”
              </p>
              <div className="mt-2 text-slate-800/80" style={{ fontSize: "var(--pc-caption, 11px)" }}>
                {quoteKindLabel(data.quote.kind)}
                {data.quote.source ? ` · ${data.quote.source}` : ""}
              </div>
            </div>
          )}
        </div>

        {/* CENTER */}
        <div className="persona-col-center space-y-5">
          {motivations.length > 0 && (
            <div>
              <SectionLabel>Purchasing motivations</SectionLabel>
              <div className="mt-1.5 text-slate-400" style={{ fontSize: "var(--pc-caption, 11px)" }}>Your team's assessment — not survey results.</div>
              <div className="mt-2.5 space-y-2.5">
                {motivations.map((m) => (
                  <MotivationBar key={m.label} label={m.label} rating={m.rating} accent={accent} />
                ))}
              </div>
            </div>
          )}

          <div className="p-4 rounded" style={{ background: "#EBEBEB" }}>
            <SectionLabel>Bio</SectionLabel>
            <div className="mt-1.5 text-slate-700" style={{ fontSize: "var(--pc-body, 13px)", lineHeight: 1.55 }}>
              {bio ? (
                <p>{bio}</p>
              ) : (
                <FactualArrangement facts={facts} rolesIndustries={meta.rolesIndustries} />
              )}
            </div>
          </div>

          {messagingInCenter && messagingBlock}
        </div>

        {/* RIGHT */}
        {hasRight && (
          <div className="persona-col-right space-y-5">
            {goals.length > 0 && <BulletSection title="Goals" items={goals} />}
            {frustrations.length > 0 && <BulletSection title="Frustrations" items={frustrations} />}
            {objections.length > 0 && <BulletSection title="Objections" items={objections} />}
            {buyingStyle.length > 0 && (
              <div>
                <SectionLabel>Buying style</SectionLabel>
                <div className="mt-1.5 text-slate-400" style={{ fontSize: "var(--pc-caption, 11px)" }}>Team assumptions unless evidence is attached.</div>
                <div className="mt-2.5 space-y-3">
                  {buyingStyle.map((b) => (
                    <BuyingScale key={b.left + b.right} item={b} accent={accent} />
                  ))}
                </div>
              </div>
            )}
            {alternatives.length > 0 && <BulletSection title="Current tools & alternatives" items={alternatives} />}
            {!messagingInCenter && messagingBlock}
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div className="px-10 py-4 border-t border-slate-200 flex items-center justify-between" style={{ fontSize: "var(--pc-meta, 11px)" }}>
        <div className="text-slate-500">
          {meta.businessName ? `${meta.businessName} · ` : ""}Prepared with FunnelRoo
        </div>
        <div className="text-slate-400 flex items-center gap-3">
          {meta.highlightsOnly && <span className="text-slate-500">Selected highlights</span>}
          {meta.stale && <span className="text-amber-600 font-medium">Needs refresh — audience changed</span>}
          <span>Updated {meta.updatedAt || "—"}</span>
          <span>{meta.reviewLabel}</span>
        </div>
      </div>
    </div>
  );
}

export default forwardRef(PersonaCard);

function SectionLabel({ children }) {
  return <div className="font-bold text-slate-900 uppercase tracking-wide" style={{ fontSize: "var(--pc-heading, 12px)" }}>{children}</div>;
}

function Portrait({ url, credit, accent, initials, origin, alt }) {
  if (!url) {
    return (
      <div
        className="w-full rounded flex items-center justify-center text-slate-400 font-semibold"
        style={{ aspectRatio: "4 / 3", background: "#F1F5F9", fontSize: "34px" }}
      >
        {initials || "A"}
      </div>
    );
  }
  const isAi = origin === "ai";
  const imgAlt = alt || (isAi ? "AI-generated illustrative portrait of this audience — not a real customer" : credit ? `Representative image. ${credit}` : "Representative image");
  return (
    <div>
      <div className="relative w-full overflow-hidden rounded" style={{ aspectRatio: "4 / 3" }}>
        <img src={url} alt={imgAlt} className="w-full h-full object-cover" crossOrigin="anonymous" />
        {!isAi && credit && <div className="absolute bottom-0 right-0 bg-black/50 text-white px-1.5 py-0.5" style={{ fontSize: "var(--pc-caption, 9px)" }}>{credit}</div>}
      </div>
      {isAi && (
        <div className="mt-1.5 text-slate-500 italic" style={{ fontSize: "var(--pc-caption, 11px)" }}>
          AI-generated illustration of this audience — not a real customer.
        </div>
      )}
    </div>
  );
}

function MotivationBar({ label, rating, accent }) {
  const rated = rating != null && rating >= 1 && rating <= 5;
  const width = rated ? (rating / 5) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-800" style={{ fontSize: "var(--pc-body, 12px)" }}>{label}</span>
        <span className="text-slate-500" style={{ fontSize: "var(--pc-caption, 11px)" }}>{rated ? RATING_LABELS[rating] : "Not rated"}</span>
      </div>
      <div className="mt-1 h-2.5 rounded-sm overflow-hidden" style={{ background: "#E0E0E0" }}>
        <div className="h-full rounded-sm" style={{ width: `${width}%`, background: accent }} />
      </div>
    </div>
  );
}

function BuyingScale({ item, accent }) {
  const pos = Math.max(0, Math.min(100, item.position));
  return (
    <div>
      <div className="flex items-center justify-between text-slate-600" style={{ fontSize: "var(--pc-caption, 11px)" }}>
        <span>{item.left}</span>
        <span>{item.right}</span>
      </div>
      <div className="relative mt-1.5 h-1.5 rounded-full" style={{ background: "#E0E0E0" }}>
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-sm" style={{ left: `${pos}%`, background: accent }} />
      </div>
      {item.pair_label && <div className="mt-1 text-slate-400" style={{ fontSize: "var(--pc-caption, 10px)" }}>{item.pair_label}</div>}
    </div>
  );
}

function BulletSection({ title, items }) {
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      <ul className="mt-1.5 space-y-1 text-slate-700" style={{ fontSize: "var(--pc-body, 13px)" }}>
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-slate-400 mt-[2px]">•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FactualArrangement({ facts, rolesIndustries }) {
  if (!facts.length && !rolesIndustries) {
    return <p className="text-slate-400 italic">Add a short summary in Edit profile or ask Roo to draft one.</p>;
  }
  return (
    <div className="space-y-1">
      {rolesIndustries && <p>{rolesIndustries}</p>}
      {facts.map((f) => (
        <p key={f.label} className="text-slate-600"><span className="font-semibold text-slate-700">{f.label}:</span> {f.value}</p>
      ))}
    </div>
  );
}

function quoteKindLabel(kind) {
  if (kind === "customer") return "Customer quote";
  if (kind === "illustrative") return "Illustrative statement — not a customer quote";
  return "Representative statement";
}