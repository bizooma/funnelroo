import React from "react";
import AppShell from "@/components/AppShell";
import { ComingSoon } from "@/components/ComingSoon";
import { Card, CardContent } from "@/components/ui/card";

export default function Contacts() {
  return (
    <AppShell>
      <div className="p-8 max-w-4xl">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Contacts</h1>
        <p className="text-sm text-slate-500 mb-6">People who submitted a funnel form or booked a meeting.</p>
        <Card>
          <CardContent>
            <ComingSoon
              title="Contact management"
              description="Contact timelines, consent, bookings, assignments and opportunity outcomes — scoped to one workspace, with normalized email and duplicate handling."
              phase="Follow-on Phase 2"
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}