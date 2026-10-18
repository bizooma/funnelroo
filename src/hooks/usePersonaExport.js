import { useCallback, useRef, useState } from "react";
import { exportPersonaPdf } from "@/lib/personaExport";

// Shared export/print mechanics for the persona card. UI concerns (toasts,
// the unsaved-edits prompt, overflow guidance) stay in the calling page; this
// hook only runs the capture/PDF build and the print trigger.
//
// rootRef points at the off-screen `.persona-print-portal` export root that
// both Download PDF (html2canvas) and Print / Save as PDF (CSS @media print)
// render from.
export function usePersonaExport(rootRef) {
  const [exportingPdf, setExportingPdf] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const cleanupRef = useRef(null);

  const exportPdf = useCallback(
    async (name) => {
      if (!rootRef.current) throw new Error("Card not ready");
      setExportingPdf(true);
      try {
        const res = await exportPersonaPdf(rootRef.current, name);
        if (res && res.overflow) setOverflow(true);
        return res;
      } finally {
        setExportingPdf(false);
      }
    },
    [rootRef]
  );

  const print = useCallback(() => {
    setPrinting(true);
    const cleanup = () => {
      setPrinting(false);
      if (cleanupRef.current) {
        window.removeEventListener("afterprint", cleanupRef.current);
        cleanupRef.current = null;
      }
    };
    cleanupRef.current = cleanup;
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    // Safety net: if afterprint never fires (e.g. an older browser or the
    // dialog is dismissed in a way that skips it), don't leave the UI stuck.
    setTimeout(() => cleanup(), 30000);
  }, []);

  return { exportingPdf, printing, overflow, exportPdf, print, setOverflow };
}