import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [current, setCurrent] = useState(null);
  const [role, setRole] = useState("member");
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const res = await base44.functions.invoke("workspaceAccess", { action: "listMine" });
      const list = res.data?.workspaces || [];
      setWorkspaces(list);
      const stored = localStorage.getItem("fr_current_ws");
      const match = list.find((w) => w.id === stored) || list[0] || null;
      if (match) {
        setCurrent(match);
        localStorage.setItem("fr_current_ws", match.id);
        const ctx = await base44.functions.invoke("workspaceAccess", {
          action: "getContext",
          workspace_id: match.id,
        });
        setRole(ctx.data?.my_role || "member");
        setProfile(ctx.data?.profile || null);
      } else {
        setCurrent(null);
        setProfile(null);
      }
    } catch (e) {
      // not authenticated or error — leave empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const switchWorkspace = useCallback(async (ws) => {
    setCurrent(ws);
    localStorage.setItem("fr_current_ws", ws.id);
    const ctx = await base44.functions.invoke("workspaceAccess", {
      action: "getContext",
      workspace_id: ws.id,
    });
    setRole(ctx.data?.my_role || "member");
    setProfile(ctx.data?.profile || null);
  }, []);

  const createWorkspace = useCallback(async (data) => {
    const res = await base44.functions.invoke("workspaceAccess", { action: "create", ...data });
    await refresh();
    const ws = res.data?.workspace;
    if (ws) await switchWorkspace(ws);
    return ws;
  }, []);

  const value = {
    workspaces,
    current,
    role,
    profile,
    loading,
    refresh,
    switchWorkspace,
    createWorkspace,
    canPublish: role === "owner" || role === "admin",
    canAdmin: role === "owner" || role === "admin",
    isOwner: role === "owner",
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}