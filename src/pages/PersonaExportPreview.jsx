import { useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import PersonaCard from "@/components/persona/PersonaCard";
import PersonaExportRoot from "@/components/persona/PersonaExportRoot";
import { personaFixture } from "@/components/persona/personaFixture";
import { usePersonaExport } from "@/hooks/usePersonaExport";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, FileDown, Loader2, Printer } from "lucide-react";

// Dev-only preview of the persona export using a fictional fixture (no live
// audience data). Lets the export layout be verified in isolation.
export default function PersonaExportPreview() {
  const rootRef = useRef(null);
  const { exportingPdf, overflow, exportPdf, print, setOverflow } = usePersonaExport(rootRef);

  async function handlePdf() {
    try {
      const res = await exportPdf(personaFixture.meta.name);
      if (!res?.overflow) toast({ title: "PDF downloaded" });
    } catch (e) {
      toast({ title: "PDF failed", description: e.message, variant: "destructive" });
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-6 lg:p-8 max-w-[1200px] mx-auto">
        <Link to="/app" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </Link>
        <h1 className="text-xl font-semibold mb-1">Persona export preview</h1>
        <p className="text-sm text-slate-500 mb-4">
          Fixture data rendered by the real PersonaCard. Use Download PDF or Print to verify the export layout
          without touching live audiences.
        </p>
        <div className="flex flex-wrap gap-2 mb-5">
          <Button onClick={handlePdf} disabled={exportingPdf}>
            {exportingPdf ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileDown className="w-4 h-4 mr-1.5" />}
            Download PDF
          </Button>
          <Button variant="outline" onClick={print} disabled={exportingPdf}>
            <Printer className="w-4 h-4 mr-1.5" /> Print / Save as PDF
          </Button>
        </div>

        {/* On-screen card uses the normal responsive layout (reflows on narrow view). */}
        <div className="rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white">
          <PersonaCard data={personaFixture} meta={personaFixture.meta} />
        </div>

        {/* Off-screen export root shared by Download PDF and Print. */}
        {createPortal(
          <div className="persona-print-portal" ref={rootRef}>
            <PersonaExportRoot data={personaFixture} meta={personaFixture.meta} />
          </div>,
          document.body
        )}

        <Dialog open={overflow} onOpenChange={setOverflow}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>More detail than fits one page</DialogTitle>
              <DialogDescription>
                This persona has more detail than fits on a readable single page. Choose fewer highlights, or use the
                expanded print layout.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOverflow(false)}>
                Close
              </Button>
              <Button
                onClick={() => {
                  setOverflow(false);
                  print();
                }}
              >
                Use Print / Save as PDF
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}