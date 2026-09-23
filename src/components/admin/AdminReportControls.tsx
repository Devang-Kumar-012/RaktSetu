"use client";

import { useActionState } from "react";

import { reviewReport } from "@/lib/actions/admin";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { Button } from "@/components/ui/Button";

/** Admin review controls for one request report. Server action + RLS guard. */
export function AdminReportControls({ reportId }: { reportId: string }) {
  const [state, formAction, pending] = useActionState(
    reviewReport,
    initialProfileActionState
  );

  return (
    <div className="space-y-2">
      <form action={formAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="reportId" value={reportId} />
        <Button type="submit" name="action" value="reviewed" disabled={pending}>
          {pending ? "Working…" : "Mark reviewed"}
        </Button>
        <Button type="submit" name="action" value="dismissed" variant="secondary" disabled={pending}>
          Dismiss
        </Button>
      </form>
      {state.error && <p className="text-sm font-medium text-red-600">{state.error}</p>}
      {state.success && (
        <p role="status" className="text-sm font-semibold text-green-700">
          {state.success}
        </p>
      )}
    </div>
  );
}
