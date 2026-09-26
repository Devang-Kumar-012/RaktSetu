"use client";

import { useEffect, useActionState, useRef, useState } from "react";
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

  /**
   * CANCELLATION IS CONFIRMED, NOT IMPLEMENTED ON FIRST CLICK.
   *
   * Cancelling is irreversible — a terminal state can never be reopened — and it
   * is reachable after a donor has already accepted. The first click therefore
   * only OPENS a confirmation; the server action is invoked by the confirm
   * button inside it. Keeping the action in its own form means the hidden
   * requestId is submitted by the confirm button and by nothing else, so no
   * other path can cancel a request by accident.
   */
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Move focus into the dialog so it is usable from the keyboard, and Escape
  // closes it without cancelling.
  useEffect(() => {
    if (!confirmingCancel) return;
    confirmRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setConfirmingCancel(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmingCancel]);

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
        <form action={cancelAction} onSubmit={() => setConfirmingCancel(false)}>
          <input type="hidden" name="requestId" value={requestId} />
          {/* The first click must NOT cancel: it opens the confirmation below. */}
          <Button
            type="button"
            variant="secondary"
            disabled={cancelPending || fulfillPending}
            onClick={() => setConfirmingCancel(true)}
          >
            {cancelPending ? "Cancelling…" : "Cancel request"}
          </Button>
        </form>
      </div>

      {confirmingCancel && (
        <div className="mt-4 rounded-md border border-blood-200 bg-blood-50 p-4">
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cancel-confirm-title"
            aria-describedby="cancel-confirm-body"
          >
            <p id="cancel-confirm-title" className="font-semibold text-ink-900">
              Are you sure you want to cancel this request?
            </p>
            <p id="cancel-confirm-body" className="mt-1 text-sm text-ink-700">
              This stops alerting nearby donors and closes the request for good.
              A cancelled request cannot be reopened, and any donor who already
              accepted will be told it is no longer needed.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <form action={cancelAction} onSubmit={() => setConfirmingCancel(false)}>
                <input type="hidden" name="requestId" value={requestId} />
                <Button ref={confirmRef} type="submit" disabled={cancelPending}>
                  {cancelPending ? "Cancelling…" : "Yes, cancel request"}
                </Button>
              </form>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmingCancel(false)}
                disabled={cancelPending}
              >
                Keep request
              </Button>
            </div>
          </div>
        </div>
      )}
      <p className="mt-2 text-sm text-ink-600">
        Cancelling stays available while the request is active — even after a
        donor accepts. Closed requests can no longer be changed.
      </p>
    </div>
  );
}
