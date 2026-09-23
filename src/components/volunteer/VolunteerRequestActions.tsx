"use client";

import { useActionState } from "react";

import {
  startAssisting,
  stopAssisting,
  saveAssistanceNote,
} from "@/lib/actions/volunteer";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/**
 * Volunteer coordination actions for one request. The server actions and
 * database RLS/functions enforce every rule — these controls are the
 * convenient entry point only. Volunteers can never change a request's
 * status or any donor's data from here.
 */
export function VolunteerRequestActions({
  requestId,
  meAssisting,
  currentNote,
}: {
  requestId: string;
  meAssisting: boolean;
  currentNote: string | null;
}) {
  const [startState, startAction, startPending] = useActionState(
    startAssisting,
    initialProfileActionState
  );
  const [stopState, stopAction, stopPending] = useActionState(
    stopAssisting,
    initialProfileActionState
  );
  const [noteState, noteAction, notePending] = useActionState(
    saveAssistanceNote,
    initialProfileActionState
  );

  const success =
    startState.success ?? stopState.success ?? noteState.success ?? null;
  const error = startState.error ?? stopState.error ?? noteState.error ?? null;

  return (
    <div className="mt-6 space-y-5 border-t border-ink-200 pt-5">
      {success && <Alert variant="success">{success}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}

      {meAssisting ? (
        <form action={stopAction}>
          <input type="hidden" name="requestId" value={requestId} />
          <Button type="submit" variant="secondary" disabled={stopPending}>
            {stopPending ? "Updating…" : "Stop assisting"}
          </Button>
        </form>
      ) : (
        <form action={startAction}>
          <input type="hidden" name="requestId" value={requestId} />
          <Button type="submit" disabled={startPending}>
            {startPending ? "Recording…" : "Assist this request"}
          </Button>
        </form>
      )}

      {meAssisting && (
        <form action={noteAction} className="space-y-3">
          <input type="hidden" name="requestId" value={requestId} />
          <Input
            label="Coordination note (only you can see it)"
            name="note"
            type="text"
            defaultValue={currentNote ?? ""}
            placeholder="e.g. Spoke to the hospital front desk at 4 pm"
            hint="A short reminder for yourself — other users never see this."
            maxLength={300}
            disabled={notePending}
          />
          <Button type="submit" variant="secondary" disabled={notePending}>
            {notePending ? "Saving…" : "Save note"}
          </Button>
        </form>
      )}
    </div>
  );
}
