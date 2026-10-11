import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { MascotBadge } from "@/components/MascotBadge";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const navigate = useNavigate();
  const [status, setStatus] = useState("loading"); // loading | ok | error
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      if (!token) {
        setStatus("error");
        setMsg("No invite token provided.");
        return;
      }
      try {
        const res = await base44.functions.invoke("workspaceAccess", { action: "acceptInvite", token });
        if (res.status === 200) {
          setStatus("ok");
        } else {
          setStatus("error");
          setMsg(res.data?.error || "Could not accept invite.");
        }
      } catch (e) {
        setStatus("error");
        setMsg(e.response?.data?.error || e.message || "Could not accept invite.");
      }
    })();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="text-center max-w-sm">
        <MascotBadge size={56} className="mx-auto" />
        {status === "loading" && <div className="mt-5 flex items-center justify-center gap-2 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /> Accepting invite…</div>}
        {status === "ok" && (
          <>
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mt-5" />
            <h1 className="text-xl font-semibold text-slate-800 mt-3">You're in!</h1>
            <p className="text-sm text-slate-500 mt-1.5">You've joined the workspace. Let's go to your dashboard.</p>
            <Button className="mt-5" onClick={() => navigate("/app")}>Go to dashboard</Button>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="w-10 h-10 text-rose-500 mx-auto mt-5" />
            <h1 className="text-xl font-semibold text-slate-800 mt-3">Invite not accepted</h1>
            <p className="text-sm text-slate-500 mt-1.5">{msg}</p>
            <Button variant="outline" className="mt-5" onClick={() => navigate("/app")}>Go home</Button>
          </>
        )}
      </div>
    </div>
  );
}