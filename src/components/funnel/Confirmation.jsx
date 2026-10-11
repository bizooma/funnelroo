import React from "react";
import { CheckCircle2, Download, Mail, AlertTriangle, ExternalLink } from "lucide-react";

// Branded confirmation shown after an accepted resource request. Provides
// immediate access to the resource and an accurate email-delivery status.
// provider_accepted means the provider took the request — not confirmed
// inbox delivery. No automatic-retry promises are shown (no retry worker
// exists yet).
export function Confirmation({ confirmation, primary }) {
  const resource = confirmation?.resource;
  const email = confirmation?.email;
  const accent = primary || "#4f46e5";

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-7 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-900">You're in!</h2>
          <p className="text-sm text-slate-500">Your request was received.</p>
        </div>
      </div>

      {resource && (
        <div className="rounded-xl border border-slate-200 p-4 mb-4">
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Your resource</p>
          <p className="font-semibold text-slate-800 mb-3">{resource.title}</p>
          <a
            href={resource.access_url}
            target={resource.delivery_type === "external" ? "_blank" : "_self"}
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-white text-sm font-medium"
            style={{ background: accent }}
          >
            {resource.delivery_type === "external" ? <ExternalLink className="w-4 h-4" /> : <Download className="w-4 h-4" />}
            {resource.delivery_type === "external" ? "Open resource" : "Access resource"}
          </a>
        </div>
      )}

      {email?.enabled && (
        <div className="text-sm">
          {email.state === "provider_accepted" || email.state === "delivered" ? (
            <p className="flex items-center gap-2 text-slate-600">
              <Mail className="w-4 h-4 text-slate-400" />
              We also sent a copy to your email.
            </p>
          ) : email.state === "pending" ? (
            <p className="flex items-center gap-2 text-slate-500">
              <Mail className="w-4 h-4 text-slate-400" />
              Your email is being sent.
            </p>
          ) : (
            <p className="flex items-start gap-2 text-amber-600">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Email delivery encountered an issue — use the access button above to get your resource now.</span>
            </p>
          )}
        </div>
      )}

      {!resource && (
        <p className="text-sm text-slate-600">Thanks for reaching out. We'll be in touch soon.</p>
      )}
    </div>
  );
}