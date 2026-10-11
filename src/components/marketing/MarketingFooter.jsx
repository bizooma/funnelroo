import { Link } from "react-router-dom";
import { Logo } from "./Logo";
import { NAV_LINKS, LOGIN_URL, APP_ENTRY } from "./constants";
import { useAuth } from "@/lib/AuthContext";

export default function MarketingFooter() {
  const { isAuthenticated, authChecked } = useAuth();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <Logo />
            <p className="mt-3 text-sm text-slate-500 max-w-xs">
              Your sales funnel sidekick.
            </p>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
              Explore
            </div>
            <ul className="space-y-2">
              {NAV_LINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="text-sm text-slate-600 hover:text-slate-900">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
              Account
            </div>
            <ul className="space-y-2">
              {authChecked && isAuthenticated ? (
                <li><Link to={APP_ENTRY} className="text-sm text-slate-600 hover:text-slate-900">Open App</Link></li>
              ) : (
                <li><Link to={LOGIN_URL} className="text-sm text-slate-600 hover:text-slate-900">Log In</Link></li>
              )}
            </ul>
          </div>
        </div>
        <div className="mt-10 pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-slate-400">© {year} FunnelRoo. All rights reserved.</p>
          <p className="text-xs text-slate-400">Privacy, terms, and contact pages will be added when available.</p>
        </div>
      </div>
    </footer>
  );
}