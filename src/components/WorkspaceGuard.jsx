import React from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { useWorkspace } from "@/lib/workspaceContext";

// Workspace-required routing guard. Wraps authenticated routes that need a
// workspace context. If the user has no workspace after loading, redirect to
// onboarding with the current path preserved as returnTo — so the selected
// template (e.g. /funnels?new=1&type=lead_magnet) resumes after onboarding.
// Only validated same-origin paths are preserved (safeReturnTo on the
// onboarding side).
export default function WorkspaceGuard() {
  const { loading, current } = useWorkspace();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!current) {
    const returnTo = location.pathname + location.search;
    return <Navigate to={`/onboarding?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <Outlet />;
}