import React, { useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { Confirmation } from "./Confirmation";

// Interactive public form for anonymous visitors. Manages local input state,
// client-side validation, a honeypot, and renders the confirmation view once
// accepted. Used by PageRenderer in public mode.
export function PublicForm({ heading, fields = [], submitLabel, primary, onSubmit, formState }) {
  const [values, setValues] = useState(/** @type {Record<string, string>} */({}));
  const [honeypot, setHoneypot] = useState("");
  const [localError, setLocalError] = useState("");
  const [consent, setConsent] = useState(false);

  const confirmation = formState?.confirmation;

  function setField(name, val) {
    setValues((v) => ({ ...v, [name]: val }));
  }

  function validate() {
    for (const f of fields) {
      const val = String(values[f.name] ?? "").trim();
      if (f.required && !val) return `${f.label || f.name} is required`;
    }
    const email = values.email;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Please enter a valid email address";
    return "";
  }

  function handleSubmit(e) {
    e.preventDefault();
    setLocalError("");
    if (honeypot) return; // bot
    const vErr = validate();
    if (vErr) { setLocalError(vErr); return; }
    onSubmit(values, consent ? "opt_in" : "opt_out", honeypot);
  }

  if (confirmation) {
    return <Confirmation confirmation={confirmation} primary={primary} />;
  }

  const submitting = formState?.submitting;
  const error = localError || formState?.error;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-7 shadow-sm">
      {heading && <h2 className="text-xl font-semibold text-slate-900 mb-4">{heading}</h2>}
      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        {fields.map((f, i) => (
          <div key={i}>
            <label className="text-xs font-medium text-slate-600" htmlFor={`f_${f.name}`}>
              {f.label}{f.required && <span className="text-rose-500"> *</span>}
            </label>
            {f.type === "textarea" ? (
              <textarea
                id={`f_${f.name}`}
                value={values[f.name] || ""}
                onChange={(e) => setField(f.name, e.target.value)}
                rows={3}
                disabled={submitting}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-50"
              />
            ) : (
              <input
                id={`f_${f.name}`}
                type={f.type || "text"}
                value={values[f.name] || ""}
                onChange={(e) => setField(f.name, e.target.value)}
                disabled={submitting}
                autoComplete={f.name === "email" ? "email" : "name"}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-50"
              />
            )}
          </div>
        ))}
        {/* honeypot */}
        <input
          type="text"
          name="website"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          className="hidden"
          aria-hidden="true"
        />
        {formState?.consentText && (
          <label className="flex items-start gap-2 text-xs text-slate-500 pt-1">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
            <span>{formState.consentText}</span>
          </label>
        )}
        {error && (
          <div className="flex items-start gap-2 text-sm text-rose-600 bg-rose-50 rounded-lg p-2.5">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="mt-1 w-full py-2.5 rounded-lg text-white text-sm font-medium disabled:opacity-60 flex items-center justify-center gap-2"
          style={{ background: primary }}
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {submitting ? "Submitting…" : (submitLabel || "Submit")}
        </button>
      </form>
    </div>
  );
}