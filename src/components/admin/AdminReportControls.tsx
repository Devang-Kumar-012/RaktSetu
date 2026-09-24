"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { reviewReport } from "@/lib/actions/admin";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { Button } from "@/components/ui/Button";
import type { ReportStatus } from "@/types";

/**
 * Admin moderation controls for ONE report.
 *
 * All three transitions run through the admin-only `reviewReport` server
 * action, which re-checks the role from the database profile and is backed by
 * the 0014 column-limited UPDATE grant plus the "Admins can review reports" RLS
 * policy. The status is never read back from a hidden field: the buttons name
 * the transition they perform.
 *
 * Terminal states (reviewed / dismissed) render a read-only confirmation with
 * no controls, so a finished report cannot be silently re-opened by accident.
 */
export function AdminReportControls({
  reportId,
  status,
}: {
  reportId: string;
  status: ReportStatus;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    reviewReport,
    initialProfileActionState
  );

  // The action revalidates server-side, but the row's own `status` prop comes
  // from the server render, so a refresh is what actually moves this report
  // into (or out of) its terminal state. Runs only on a fresh success.
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  if (status === "reviewed" || status === "dismissed") {
    return (
      <p className="text-sm font-semibold text-ink-600">
        {status === "reviewed"
          ? "Reviewed — no further action needed."
          : "Dismissed — closed without action."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <form action={formAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="reportId" value={reportId} />
        <Button
          type="submit"
          name="action"
          value="under_review"
          variant="secondary"
          disabled={pending}
        >
          {pending ? "Working…" : "Start review"}
        </Button>
        <Button type="submit" name="action" value="reviewed" disabled={pending}>
          Mark reviewed
        </Button>
        <Button
          type="submit"
          name="action"
          value="dismissed"
          variant="secondary"
          disabled={pending}
        >
          Dismiss
        </Button>
      </form>
      {state.error && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-sm font-semibold text-green-700">
          {state.success}
        </p>
      )}
    </div>
  );
}
