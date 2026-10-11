import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkspace } from "@/lib/workspaceContext";
import { base44 } from "@/api/base44Client";
import AppShell from "@/components/AppShell";
import { MascotBadge } from "@/components/MascotBadge";
import { ComingSoon } from "@/components/ComingSoon";
import { RooPanel } from "@/components/RooPanel";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FolderKanban, Plus, ArrowRight, Users, Calendar, BarChart3 } from "lucide-react";

export default function Dashboard() {
  const { current, loading, canPublish } = useWorkspace();
  const navigate = useNavigate();
  const [funnels, setFunnels] = useState([]);
  const [brief, setBrief] = useState(null);

  useEffect(() => {
    if (!current) return;
    (async () => {
      try {
        const [fRes, bRes] = await Promise.all([
          base44.functions.invoke("funnelAccess", { action: "list", workspace_id: current.id }),
          base44.functions.invoke("briefAccess", { action: "getBrief", workspace_id: current.id }),
        ]);
        setFunnels(fRes.data?.funnels || []);
        setBrief(bRes.data);
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
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <MascotBadge size={64} className="mx-auto" />
          <h1 className="text-xl font-semibold text-slate-800 mt-4">Let's set up your first workspace</h1>
          <p className="text-sm text-slate-500 mt-1.5">Create a workspace to start building funnels.</p>
          <Button className="mt-5" onClick={() => navigate("/onboarding")}>
            <Plus className="w-4 h-4 mr-1.5" /> Create workspace
          </Button>
        </div>
      </div>
    );
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
          <Button onClick={() => navigate("/funnels")}>
            <Plus className="w-4 h-4 mr-1.5" /> New funnel
          </Button>
        </div>

        {/* Roo suggestion strip */}
        <div className="flex items-start gap-3.5 bg-indigo-50/60 border border-indigo-100 rounded-2xl p-4 mb-8">
          <MascotBadge size={40} src={current.mascot_image_url} />
          <div className="flex-1">
            <div className="text-sm font-medium text-slate-800">
              {funnels.length === 0 ? "Start by creating your first funnel." : published.length === 0 ? "You have drafts ready — review and publish one." : "Your funnels are live. Contacts and bookings arrive in the next release."}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {funnels.length === 0 ? "Roo will guide you through audience, offer, and page content." : "Ask Roo for the next recommended action on any funnel."}
            </p>
          </div>
          <RooPanel
            title="What should I do next?"
            action="suggestNextStep"
            context={{ funnel_count: funnels.length, published: published.length, drafts: drafts.length, brief_complete: brief?.profile?.onboarding_complete }}
          />
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatCard icon={FolderKanban} label="Funnels" value={funnels.length} sub={`${published.length} live · ${drafts.length} draft`} />
          <StatCard icon={Users} label="Contacts" value="—" sub="Next release" />
          <StatCard icon={Calendar} label="Bookings" value="—" sub="Next release" />
        </div>

        <h2 className="text-sm font-semibold text-slate-700 mb-3">Recent funnels</h2>
        {funnels.length === 0 ? (
          <div className="border border-dashed border-slate-200 rounded-2xl p-10 text-center">
            <FolderKanban className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm text-slate-500 mt-2">No funnels yet. Create your first one to get started.</p>
            <Button variant="outline" className="mt-4" onClick={() => navigate("/funnels")}>
              Create a funnel <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </div>
        ) : (
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
        )}

        <div className="mt-10">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Reporting</h2>
          <Card>
            <ComingSoon title="Activity & cohort reporting" description="Sessions, accepted forms, acquired leads, confirmed bookings, attendance and won outcomes — with template-specific metrics." phase="Follow-on Phase 3" />
          </Card>
        </div>
      </div>
    </AppShell>
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