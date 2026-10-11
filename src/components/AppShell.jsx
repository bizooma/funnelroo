import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkspace } from "@/lib/workspaceContext";
import { useAuth } from "@/lib/AuthContext";
import { MascotBadge } from "@/components/MascotBadge";
import {
  LayoutDashboard, FolderKanban, Users, Settings, BookOpen, Sparkles, ChevronDown, Package,
} from "lucide-react";
import { useState } from "react";

const nav = [
  { to: "/app", label: "Overview", icon: LayoutDashboard },
  { to: "/funnels", label: "Funnels", icon: FolderKanban },
  { to: "/resources", label: "Resources", icon: Package },
  { to: "/contacts", label: "Contacts", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function AppShell({ children }) {
  const { current, workspaces, switchWorkspace, profile } = useWorkspace();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [wsOpen, setWsOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#f7f8fa] flex">
      {/* Sidebar */}
      <aside className="w-60 bg-white border-r border-slate-200 flex flex-col sticky top-0 h-screen">
        <div className="px-5 py-5 flex items-center gap-2.5 border-b border-slate-100">
          <MascotBadge size={36} src={current?.mascot_image_url} />
          <div>
            <div className="font-semibold text-slate-900 leading-tight">FunnelRoo</div>
            <div className="text-[11px] text-slate-400 leading-tight">Funnel builder</div>
          </div>
        </div>

        {/* Workspace switcher */}
        <div className="px-3 py-3 border-b border-slate-100 relative">
          <button
            onClick={() => setWsOpen((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-slate-50 text-left"
          >
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">Workspace</div>
              <div className="text-sm font-medium text-slate-800 truncate">{current?.name || "—"}</div>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          </button>
          {wsOpen && (
            <div className="absolute left-3 right-3 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 overflow-hidden">
              {workspaces.map((w) => (
                <button
                  key={w.id}
                  onClick={() => { switchWorkspace(w); setWsOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${w.id === current?.id ? "bg-indigo-50 text-indigo-700" : "text-slate-700"}`}
                >
                  {w.name}
                  <span className="text-[10px] text-slate-400 ml-1.5 capitalize">{w.my_role}</span>
                </button>
              ))}
              <Link to="/onboarding" onClick={() => setWsOpen(false)} className="block px-3 py-2 text-sm text-indigo-600 hover:bg-slate-50 border-t border-slate-100">
                + New workspace
              </Link>
            </div>
          )}
        </div>

        <nav className="flex-1 px-3 py-3 space-y-1">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  window.location.pathname === item.to
                    ? "bg-indigo-50 text-indigo-700 font-medium"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Icon className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
                <span>{item.label}</span>
                {item.soon && <span className="ml-auto text-[9px] uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Soon</span>}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-3 border-t border-slate-100 space-y-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Roo is here to help</span>
          </div>
          <button
            onClick={() => logout()}
            className="text-xs text-slate-400 hover:text-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
          >
            Log out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
    </div>
  );
}