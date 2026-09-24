"use client";

import { useActionState } from "react";

import { submitRequestReport } from "@/lib/actions/admin";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { REPORT_DETAILS_MAX, REPORT_REASONS } from "@/lib/constants";

/**
 * Minimal report form so a user can flag a suspicious or incorrect request.
 *
 * Design constraints that matter here:
 *  - A reason is REQUIRED and starts unselected, so the choice is deliberate
 *    rather than a silent default that could file the wrong report.
 *  - `alreadyReported` is resolved by the SERVER (own-row RLS), so someone who
 *    has already reported is told plainly instead of being offered a form that
 *    is guaranteed to fail.
 *  - The submit button is disabled while the action is in flight, which is what
 *    prevents an accidental double submission; the database's unique constraint
 *    is still the real guarantee.
 *  - Deliberately low-key (secondary button, no alarm colours) so it never
 *    competes with the emergency actions on the same screen.
 */
export function RequestReportForm({
  requestId,
  alreadyReported = false,
}: {
  requestId: string;
  alreadyReported?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    submitRequestReport,
    initialProfileActionState
  );

  if (alreadyReported || (state.ok && state.success)) {
    return (
      <Alert variant="success" title="Report received">
        {state.ok && state.success
          ? state.success
          : "You have already reported this request. An administrator will review it."}
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.error && <Alert variant="error">{state.error}</Alert>}
      <input type="hidden" name="requestId" value={requestId} />
      <label className="block">
        <span className="mb-1.5 block text-base font-semibold text-ink-900">
          Reason <span className="text-blood-700">(required)</span>
        </span>
        <select
          name="reason"
          required
          defaultValue=""
          disabled={pending}
          className="w-full rounded-md border border-ink-200 bg-white px-4 py-3 text-base text-ink-900 shadow-sm focus:border-blood-600 focus:ring-2 focus:ring-blood-100 focus:outline-none"
        >
          <option value="" disabled>
            Choose a reason…
          </option>
          {REPORT_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <Input
        label="What looked wrong? (optional)"
        name="details"
        type="text"
        maxLength={REPORT_DETAILS_MAX}
        placeholder="A short, factual note — no medical details or phone numbers."
        disabled={pending}
      />
      <p className="text-sm text-ink-600">
        Reporting does not cancel or hide the request. An administrator reviews
        every report.
      </p>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Sending…" : "Send report"}
      </Button>
    </form>
  );
}
