"use client";

import { useActionState } from "react";

import { submitRequestReport } from "@/lib/actions/admin";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { REPORT_REASONS } from "@/lib/constants";

/** Minimal report form so users can flag suspicious/fake blood requests. */
export function RequestReportForm({ requestId }: { requestId: string }) {
  const [state, formAction, pending] = useActionState(
    submitRequestReport,
    initialProfileActionState
  );

  if (state.ok && state.success) {
    return <Alert variant="success">{state.success}</Alert>;
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.error && <Alert variant="error">{state.error}</Alert>}
      <input type="hidden" name="requestId" value={requestId} />
      <label className="block">
        <span className="mb-1.5 block text-base font-semibold text-ink-900">
          Reason
        </span>
        <select
          name="reason"
          defaultValue="fake"
          disabled={pending}
          className="w-full rounded-md border border-ink-200 bg-white px-4 py-3 text-base text-ink-900 shadow-sm focus:border-blood-600 focus:ring-2 focus:ring-blood-100 focus:outline-none"
        >
          {REPORT_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <Input
        label="Details (optional)"
        name="details"
        type="text"
        maxLength={500}
        placeholder="What looked wrong?"
        disabled={pending}
      />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Sending…" : "Report this request"}
      </Button>
    </form>
  );
}
