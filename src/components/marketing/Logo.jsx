import { LOGO_URL } from "./constants";

// FunnelRoo brand lockup: approved logo mark + wordmark.
export function Logo({ withText = true, className = "", imgClassName = "" }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <img
        src={LOGO_URL}
        alt="FunnelRoo logo"
        className={`h-8 w-auto rounded-md object-contain ${imgClassName}`}
      />
      {withText && (
        <span className="text-lg font-bold tracking-tight text-slate-900">
          FunnelRoo
        </span>
      )}
    </span>
  );
}