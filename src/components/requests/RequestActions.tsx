"use client";

import { useActionState } from "react";

import { cancelBloodRequest, fulfillBloodRequest } from "@/lib/actions/requests";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { Button } from "@/components/ui/Button";

/**
 * Requester actions for their own ACTIVE request. The server action and
 * database RLS enforce ownership and lifecycle — these buttons are the
 * convenient entry point only.
 */
export function RequestActions({ requestId }: { requestId: string }) {
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelBloodRequest,
    initialProfileActionState
  );
  const [fulfillState, fulfillAction, fulfillPending] = useActionState(
    fulfillBloodRequest,
    initialProfileActionState
  );

  const message =
    (cancelState.ok && cancelState.success) ||
    (fulfillState.ok && fulfillState.success) ||
    cancelState.error ||
    fulfillState.error;

  return (
    <div className="mt-4 border-t border-ink-200 pt-4">
      {message && (
        <p
          role="status"
          className={`mb-3 text-sm font-semibold ${message === cancelState.success || message === fulfillState.success ? "text-green-700" : "text-red-600"}`}
        >
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <form action={fulfillAction}>
          <input type="hidden" name="requestId" value={requestId} />
          <Button type="submit" disabled={fulfillPending}>
            {fulfillPending ? "Updating…" : "Mark fulfilled"}
          </Button>
        </form>
        <form action={cancelAction}>
          <input type="hidden" name="requestId" value={requestId} />
          <Button type="submit" variant="secondary" disabled={cancelPending}>
            {cancelPending ? "Cancelling…" : "Cancel request"}
          </Button>
        </form>
      </div>
    </div>
  );
}
