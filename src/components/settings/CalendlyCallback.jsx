import React, { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2 } from "lucide-react";

export default function CalendlyCallback() {
  const started = useRef(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Support both direct Calendly params (code/state) and forwarded params
    // (calendly_code/calendly_state) from the function endpoint fallback.
    const hasCode = params.has("code") || params.has("calendly_code");
    if (started.current || (!hasCode && !params.has("error") && !params.has("calendly_error"))) return;
    started.current = true;
    const code = params.get("code") || params.get("calendly_code");
    const state = params.get("state") || params.get("calendly_state");
    const error = params.get("error") || params.get("calendly_error");
    for (const key of ["code", "state", "error", "calendly_code", "calendly_state", "calendly_error"]) params.delete(key);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
    if (error) { setMessage("Calendly authorization was not completed. Click Connect Calendly to try again."); return; }
    setBusy(true);
    base44.functions.invoke("calendlyAccess", { action: "callback", code, state })
      .then(() => { window.location.replace("/settings?tab=integrations"); })
      .catch(e => { setMessage(e.response?.data?.error || "Could not finish connecting Calendly. Click Connect Calendly again."); setBusy(false); });
  }, []);
  if (!busy && !message) return null;
  return <div role="status" className="mb-4 rounded-md border border-border bg-muted p-4 text-sm text-foreground">
    {busy ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Finishing Calendly connection...</span> : message}
  </div>;
}