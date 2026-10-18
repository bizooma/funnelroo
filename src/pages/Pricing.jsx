import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import MarketingHeader from "@/components/marketing/MarketingHeader";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import { Button } from "@/components/ui/button";
import { Check, Loader2, ChevronDown } from "lucide-react";

// Public pricing page. Loads the server-controlled catalog (no auth) and
// never exposes private workspace records. Plan/interval selection is a
// nonbinding preference passed to signup; it does not start Checkout or
// grant any allowance.
export default function Pricing() {
  const { isAuthenticated, authChecked } = useAuth();
  const [catalog, setCatalog] = useState(null);
  const [interval, setInterval] = useState("monthly"); // default Monthly
  const [loading, setLoading] = useState(true);
  const [openFaq, setOpenFaq] = useState(null);

  useEffect(() => {
    base44.functions
      .invoke("billingAccess", { action: "getCatalog" })
      .then((res) => setCatalog(res.data?.catalog))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function ctaHref(planId) {
    const params = new URLSearchParams({ plan: planId, interval });
    if (authChecked && isAuthenticated) {
      return `/settings?tab=billing`;
    }
    return `/register?returnTo=${encodeURIComponent("/app")}&${params.toString()}`;
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <MarketingHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-5 pt-16 pb-10 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 tracking-tight">
            A clear plan for your next customer.
          </h1>
          <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
            Prepare your marketing, build your funnel, and follow up with leads — with Roo helping you along the way.
          </p>
          <p className="mt-3 text-sm text-slate-500">
            Start a 14-day free trial. <span className="font-medium text-slate-700">No credit card required.</span> Choose a paid plan when you're ready.
          </p>
        </section>

        {/* Interval toggle */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 p-1">
            <button
              onClick={() => setInterval("monthly")}
              className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${interval === "monthly" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
            >
              Monthly
            </button>
            <button
              onClick={() => setInterval("annual")}
              className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${interval === "annual" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
            >
              Annual <span className="text-emerald-600">save ~16.7%</span>
            </button>
          </div>
        </div>

        {/* Plan cards */}
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
        ) : (
          <section className="mx-auto max-w-5xl px-5 pb-12">
            <div className="grid gap-6 md:grid-cols-2">
              {(catalog?.plans || []).map((plan) => {
                const price = plan.prices[interval];
                const isAnnual = interval === "annual";
                const monthlyEquiv = isAnnual ? plan.prices.annual.monthly_equivalent_cents : null;
                return (
                  <div
                    key={plan.id}
                    className={`relative rounded-2xl border bg-white p-7 flex flex-col ${plan.highlight ? "border-slate-900 shadow-lg" : "border-slate-200 shadow-sm"}`}
                  >
                    {plan.highlight && (
                      <span className="absolute -top-3 left-7 bg-slate-900 text-white text-xs font-medium px-3 py-1 rounded-full">
                        {plan.highlight}
                      </span>
                    )}
                    <h2 className="text-xl font-bold text-slate-900">{plan.name}</h2>
                    <p className="mt-1 text-sm text-slate-500">{plan.tagline}</p>
                    <div className="mt-5 flex items-baseline gap-1">
                      <span className="text-4xl font-bold text-slate-900">{price.display.split("/")[0]}</span>
                      <span className="text-slate-500">/{price.interval === "year" ? "yr" : "mo"}</span>
                    </div>
                    {isAnnual && monthlyEquiv != null && (
                      <p className="mt-1 text-xs text-slate-500">
                        About ${(monthlyEquiv / 100).toFixed(2)}/mo equivalent, billed annually
                      </p>
                    )}
                    <Button asChild className="mt-6" size="lg">
                      <Link to={ctaHref(plan.id)}>Start 14-day free trial</Link>
                    </Button>
                    <p className="mt-2 text-center text-xs text-slate-400">No credit card required</p>

                    <div className="mt-6 space-y-2.5 text-sm">
                      <Allowance label="Live funnels" value={plan.allowances.live_funnels} />
                      <Allowance label="Team users" value={plan.allowances.team_users} suffix="incl. owner" />
                      <Allowance label="Stored contacts" value={plan.allowances.contacts.toLocaleString()} />
                      <Allowance label="Email sends" value={plan.allowances.email_sends_per_month.toLocaleString()} suffix="/mo" />
                      <Allowance label="AI text actions" value={plan.allowances.ai_text_actions_per_month.toLocaleString()} suffix="/mo" />
                      <Allowance label="Generated images" value={plan.allowances.images_per_month} suffix="/mo" />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Core features */}
            <div className="mt-12 rounded-2xl bg-slate-50 border border-slate-200 p-7">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-4">Included in both plans</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {(catalog?.core_features || []).map((f) => (
                  <div key={f} className="flex items-start gap-2 text-sm text-slate-700">
                    <Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs text-slate-500">
                Booking runs through your own Calendly account, whose plan requirements are separate from your FunnelRoo plan.
              </p>
            </div>

            {/* Usage definitions */}
            <div className="mt-10">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-4">How usage is counted</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {(catalog?.usage_definitions || []).map((d) => (
                  <div key={d.key} className="text-sm">
                    <span className="font-medium text-slate-800">{d.label}.</span>{" "}
                    <span className="text-slate-600">{d.description}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* FAQs */}
            <div className="mt-12">
              <h3 className="text-2xl font-bold text-slate-900 mb-6 text-center">Frequently asked questions</h3>
              <div className="mx-auto max-w-3xl divide-y divide-slate-200 border border-slate-200 rounded-2xl bg-white">
                {(catalog?.faqs || []).map((f, i) => (
                  <div key={i}>
                    <button
                      onClick={() => setOpenFaq(openFaq === i ? null : i)}
                      className="w-full flex items-center justify-between px-5 py-4 text-left"
                    >
                      <span className="text-sm font-medium text-slate-800">{f.q}</span>
                      <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${openFaq === i ? "rotate-180" : ""}`} />
                    </button>
                    {openFaq === i && <p className="px-5 pb-4 text-sm text-slate-600">{f.a}</p>}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
      <MarketingFooter />
    </div>
  );
}

function Allowance({ label, value, suffix }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-600">{label}</span>
      <span className="font-medium text-slate-900">
        {value} {suffix && <span className="text-slate-400 font-normal">{suffix}</span>}
      </span>
    </div>
  );
}