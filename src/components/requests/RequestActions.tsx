"use client";

import { useEffect, useActionState } from "react";
import { useRouter } from "next/navigation";

import { cancelBloodRequest, fulfillBloodRequest } from "@/lib/actions/requests";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { Button } from "@/components/ui/Button";

/**
 * Requester actions for their own ACTIVE request. The server action and
 * database RLS enforce ownership and lifecycle — these buttons are the
 * convenient entry point only.
 *
 * - "Mark fulfilled" (primary) and "Cancel request" (secondary) stay
 *   visually distinct; cancellation remains available even after a donor
 *   accepts, as long as the request is still active.
 * - A successful action refreshes the page, so the new lifecycle state,
 *   accepted-donor reveal, and closed-request messaging appear at once.
 * - A lost race (another action, or the expiry sweep, got there first)
 *   comes back from the server as a plain-language message.
 */
export function RequestActions({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelBloodRequest,
    initialProfileActionState
  );
  const [fulfillState, fulfillAction, fulfillPending] = useActionState(
    fulfillBloodRequest,
    initialProfileActionState
  );

  const succeeded = cancelState.ok || fulfillState.ok;
  useEffect(() => {
    if (succeeded) router.refresh();
  }, [succeeded, router]);

  // Errors are the most recent, actionable signal — they win over success.
  const error = cancelState.error || fulfillState.error || null;
  const success = error
    ? null
    : (cancelState.ok && cancelState.success) ||
      (fulfillState.ok && fulfillState.success) ||
      null;

  return (
    <div className="mt-4 border-t border-ink-200 pt-4">
      {error && (
        <p role="alert" className="mb-3 text-sm font-semibold text-red-600">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="mb-3 text-sm font-semibold text-green-700">
          {success}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <form action={fulfillAction}>
          <input type="hidden" name="requestId" value={requestId} />
          <Button type="submit" disabled={fulfillPending || cancelPending}>
            {fulfillPending ? "Updating…" : "Mark fulfilled"}
          </Button>
        </form>
        <form action={cancelAction}>
          <input type="hidden" name="requestId" value={requestId} />
          <Button
            type="submit"
            variant="secondary"
            disabled={cancelPending || fulfillPending}
          >
            {cancelPending ? "Cancelling…" : "Cancel request"}
          </Button>
        </form>
      </div>
      <p className="mt-2 text-sm text-ink-600">
        Cancelling stays available while the request is active — even after a
        donor accepts. Closed requests can no longer be changed.
      </p>
    </div>
  );
}
