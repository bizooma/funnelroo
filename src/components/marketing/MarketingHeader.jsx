import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "./Logo";
import { NAV_LINKS, LOGIN_URL, REGISTER_URL, APP_ENTRY } from "./constants";
import { useAuth } from "@/lib/AuthContext";

export default function MarketingHeader() {
  const { isAuthenticated, authChecked } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const AuthButtons = ({ mobile = false }) => {
    if (!authChecked) return null;
    if (isAuthenticated) {
      return (
        <Button asChild className={mobile ? "w-full" : ""}>
          <Link to={APP_ENTRY}>Open App</Link>
        </Button>
      );
    }
    return (
      <>
        <Button variant="ghost" asChild className={mobile ? "w-full" : ""}>
          <Link to={LOGIN_URL}>Log In</Link>
        </Button>
        <Button asChild className={mobile ? "w-full" : ""}>
          <Link to={REGISTER_URL}>Get Started</Link>
        </Button>
      </>
    );
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200/70 bg-white/80 backdrop-blur">
      <div className="mx-auto max-w-6xl px-5 h-16 flex items-center justify-between">
        <Link to="/" aria-label="FunnelRoo home" className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
          <Logo className="h-11" />
        </Link>

        <nav className="hidden md:flex items-center gap-7" aria-label="Marketing">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-2">
          <AuthButtons />
        </div>

        <button
          className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {open && (
        <div id="mobile-menu" className="md:hidden border-t border-slate-200 bg-white px-5 py-4 space-y-1">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block px-2 py-2.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {l.label}
            </a>
          ))}
          <div className="pt-3 mt-2 border-t border-slate-100 flex flex-col gap-2">
            <AuthButtons mobile />
          </div>
        </div>
      )}
    </header>
  );
}