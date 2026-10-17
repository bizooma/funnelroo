import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useWorkspace } from "@/lib/workspaceContext";
import AppShell from "@/components/AppShell";
import BusinessBrandManager from "@/components/marketing-kit/BusinessBrandManager";
import AudienceManager from "@/components/marketing-kit/AudienceManager";
import OfferManager from "@/components/marketing-kit/OfferManager";
import { Card, CardContent } from "@/components/ui/card";
import { Package, Users, Tag, Briefcase, ArrowRight } from "lucide-react";

const AREAS = [
  { id: "brand", label: "Business & brand", icon: Briefcase, desc: "Your business information and style, used across all funnels." },
  { id: "audiences", label: "Audiences", icon: Users, desc: "The types of customers you want to reach." },
  { id: "offers", label: "Offers", icon: Tag, desc: "The products or services you promote." },
  { id: "resources", label: "Resources", icon: Package, desc: "Materials shared with leads." },
];

export default function MarketingKit() {
  const { current, loading } = useWorkspace();
  const [area, setArea] = useState(() => new URLSearchParams(window.location.search).get("area") || "brand");

  if (loading) return <AppShell><div className="p-8"><div className="w-8 h-8 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" /></div></AppShell>;
  if (!current) return null;

  return (
    <AppShell>
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Marketing kit</h1>
        <p className="text-sm text-slate-500 mb-6">Prepare your reusable marketing assets. Roo uses them to tailor every funnel.</p>

        {/* Area cards */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {AREAS.map((a) => {
            const Icon = a.icon;
            const active = area === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setArea(a.id)}
                className={`text-left p-4 rounded-xl border transition-colors ${active ? "border-indigo-500 bg-indigo-50/50" : "border-slate-200 hover:bg-slate-50"}`}
              >
                <Icon className={`w-5 h-5 mb-2 ${active ? "text-indigo-600" : "text-slate-400"}`} />
                <div className={`text-sm font-medium ${active ? "text-indigo-700" : "text-slate-800"}`}>{a.label}</div>
                <div className="text-xs text-slate-400 mt-0.5 leading-snug">{a.desc}</div>
              </button>
            );
          })}
        </div>

        {area === "brand" && <BusinessBrandManager />}
        {area === "audiences" && <AudienceManager />}
        {area === "offers" && <OfferManager />}
        {area === "resources" && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <Package className="w-5 h-5 text-slate-400" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-slate-800">Resource library</div>
                  <div className="text-xs text-slate-500">Manage your shared resources in the dedicated library.</div>
                </div>
                <Link to="/resources">
                  <span className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700">
                    Open resources <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}