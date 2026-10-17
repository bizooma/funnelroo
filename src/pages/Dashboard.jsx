import React, { useEffect, useState } from "react";
import { Link, useNavigate, Navigate } from "react-router-dom";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import AppShell from "@/components/AppShell";
import { MascotBadge } from "@/components/MascotBadge";
import { Image } from "@/components/ui/image";
import { RooPanel } from "@/components/RooPanel";
import ConversionReport from "@/components/dashboard/ConversionReport";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FolderKanban, Plus, ArrowRight, Users, Calendar, Check } from "lucide-react";

export default function Dashboard() {
  const { current, loading } = useWorkspace();
  const navigate = useNavigate();
  const [funnels, setFunnels] = useState([]);
  const [brief, setBrief] = useState(null);
  const [stats, setStats] = useState({ contacts: null, bookings: null });
  const [dashState, setDashState] = useState(null);

  useEffect(() => {
    if (!current) return;
    (async () => {
      try {
        const [fRes, bRes, rRes, dRes] = await Promise.all([
          base44.functions.invoke("funnelAccess", { action: "list", workspace_id: current.id }),
          base44.functions.invoke("briefAccess", { action: "getBrief", workspace_id: current.id }),
          base44.functions.invoke("bookingAccess", { action: "report", workspace_id: current.id }),
          base44.functions.invoke("marketingKitAccess", { action: "getDashboardState", workspace_id: current.id }),
        ]);
        setFunnels(fRes.data?.funnels || []);
        setBrief(bRes.data);
        const m = rRes.data?.metrics || {};
        setStats({
          contacts: m.captured_leads ?? null,
          bookings: m.gross_booked_appointments ?? null,
        });
        setDashState(dRes.data);
      } catch {}
    })();
  }, [current]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!current) {
    return <Navigate to="/onboarding" replace />;
  }

  const published = funnels.filter((f) => f.state === "published");
  const drafts = funnels.filter((f) => f.state === "draft");

  return (
    <AppShell>
      <div className="p-8 max-w-6xl">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{current.name}</h1>
            <p className="text-sm text-slate-500 mt-1">Here's how your funnels are doing.</p>
          </div>
          <Button onClick={() => navigate("/guided-setup")}>
            <Plus className="w-4 h-4 mr-1.5" /> New funnel
          </Button>
        </div>

        {dashState?.mode === "launch_guide" ? (
          <LaunchGuide dashState={dashState} funnels={funnels} brief={brief} />
        ) : (
          <>
            <div className="flex items-start gap-3.5 bg-indigo-50/60 border border-indigo-100 rounded-2xl p-4 mb-8">
              <MascotBadge size={40} src={current.mascot_image_url} />
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-800">
                  {published.length === 0 ? "You have drafts ready — review and publish one." : "Your funnels are live. Contacts and bookings arrive in the next release."}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">Ask Roo for the next recommended action on any funnel.</p>
              </div>
              <RooPanel
                title="What should I do next?"
                action="suggestNextStep"
                context={{ funnel_count: funnels.length, published: published.length, drafts: drafts.length, brief_complete: brief?.profile?.onboarding_complete }}
              />
            </div>

            <div className="grid grid-cols-3 gap-4 mb-8">
              <StatCard icon={FolderKanban} label="Funnels" value={funnels.length} sub={`${published.length} live · ${drafts.length} draft`} />
              <StatCard icon={Users} label="Leads" value={stats.contacts ?? "—"} sub={stats.contacts === null ? "Loading…" : "Captured"} />
              <StatCard icon={Calendar} label="Bookings" value={stats.bookings ?? "—"} sub={stats.bookings === null ? "Loading…" : "Gross booked"} />
            </div>

            <h2 className="text-sm font-semibold text-slate-700 mb-3">Recent funnels</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {funnels.slice(0, 4).map((f) => (
                <Link key={f.id} to={`/funnels/${f.id}`} className="block">
                  <Card className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-slate-800">{f.name}</div>
                          <div className="text-xs text-slate-400 capitalize mt-0.5">{f.type.replace("_", " ")}</div>
                        </div>
                        <StateBadge state={f.state} />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </>
        )}

        <div className="mt-10">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Conversion reporting</h2>
          <ConversionReport />
        </div>
      </div>
    </AppShell>
  );
}

function LaunchGuide({ dashState, funnels, brief }) {
  const navigate = useNavigate();
  const { nextAction, heading, subheading } = dashState;
  const profile = brief?.profile || {};
  const hasBusiness = !!(profile.business_name || profile.primary_service);
  const readyAudiences = (brief?.audiences || []).filter((a) => a.status === "ready" || a.approved);
  const readyOffers = (brief?.offers || []).filter((o) => o.status === "ready" || o.approved);

  const steps = [
    { label: "Prepare", done: hasBusiness && readyAudiences.length > 0 && readyOffers.length > 0 },
    { label: "Build", done: funnels.length > 0 },
    { label: "Launch", done: funnels.some((f) => f.state === "published") },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">{heading}</h2>
        <p className="text-sm text-slate-500 mt-1">{subheading}</p>
      </div>

      {/* Progress overview */}
      <div className="flex items-center gap-3">
        {steps.map((s, i) => (
          <div key={s.label} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${s.done ? "bg-emerald-100 text-emerald-700" : i === 0 && !steps[0].done ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-400"}`}>
              {s.done ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <span className={`text-sm ${s.done ? "text-slate-700" : "text-slate-400"}`}>{s.label}</span>
            {i < steps.length - 1 && <div className="w-8 h-px bg-slate-200" />}
          </div>
        ))}
      </div>

      {/* Next action card */}
      {nextAction && (
        <Card className="border-indigo-200 bg-indigo-50/30">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <Image
                src="https://media.base44.com/images/public/6acba9de240facdd95f5665d/255ed3391_point-right1.png"
                alt="Roo pointing to your next step"
                className="h-24 w-24 shrink-0"
                fittingType="fit"
              />
              <div className="flex-1">
                <div className="text-xs text-slate-500">Next step</div>
                <div className="text-sm font-medium text-slate-800 mt-0.5">{nextAction.label}</div>
              </div>
              <Button onClick={() => navigate(nextAction.destination)}>
                <ArrowRight className="w-4 h-4 mr-1.5" /> Go
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Saved work */}
      <div className="grid grid-cols-3 gap-3">
        <WorkCard label="Business basics" done={hasBusiness} destination="/marketing-kit" />
        <WorkCard label="Audiences" count={readyAudiences.length} destination="/marketing-kit?area=audiences" />
        <WorkCard label="Offers" count={readyOffers.length} destination="/marketing-kit?area=offers" />
      </div>

      {funnels.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Your funnels</h3>
          <div className="grid md:grid-cols-2 gap-3">
            {funnels.slice(0, 4).map((f) => (
              <Link key={f.id} to={`/funnels/${f.id}`} className="block">
                <Card className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-slate-800">{f.name}</div>
                        <div className="text-xs text-slate-400 capitalize mt-0.5">{f.type.replace("_", " ")}</div>
                      </div>
                      <StateBadge state={f.state} />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkCard({ label, done, count, destination }) {
  return (
    <Link to={destination} className="block">
      <Card className="hover:shadow-sm transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            {done || count > 0 ? <Check className="w-4 h-4 text-emerald-500" /> : <div className="w-4 h-4 rounded-full border-2 border-slate-200" />}
            <span className="text-sm text-slate-700">{label}</span>
          </div>
          <div className="text-xs text-slate-400 mt-1">{count !== undefined ? `${count} ready` : done ? "Set" : "Not started"}</div>
        </CardContent>
      </Card>
    </Link>
  );
}

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-slate-400 mb-1.5">
          <Icon className="w-4 h-4" />
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <div className="text-2xl font-bold text-slate-900">{value}</div>
        <div className="text-xs text-slate-400 mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}

function StateBadge({ state }) {
  const map = {
    draft: "bg-slate-100 text-slate-600",
    published: "bg-emerald-100 text-emerald-700",
    paused: "bg-amber-100 text-amber-700",
    archived: "bg-slate-100 text-slate-400",
  };
  return <span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${map[state] || map.draft}`}>{state}</span>;
}