"use client";

import { useActionState } from "react";

import { registerForDrive, unregisterFromDrive } from "@/lib/actions/drives";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { DRIVE_REGISTRATION_NOTE_MAX } from "@/lib/constants";
import type { DriveRegistrationStatus } from "@/types";

/**
 * The donor's own registration control for one drive.
 *
 * All states are rendered explicitly, because they are genuinely different:
 * not a donor, already registered, checked in, took part, withdrew, and the
 * drive is closed. A settled registration is shown read-only rather than
 * offering a button the database would refuse.
 *
 * The server is the authority — `registrationStatus` is resolved there under
 * own-row RLS, and the unique (drive, donor) constraint means a double submit
 * cannot create two registrations even if the button were clicked twice.
 */
export function DriveRegistrationPanel({
  driveId,
  status,
  openForRegistration,
  isDonor,
}: {
  driveId: string;
  status: DriveRegistrationStatus | null;
  openForRegistration: boolean;
  isDonor: boolean;
}) {
  const [registerState, registerAction, registering] = useActionState(
    registerForDrive,
    initialProfileActionState
  );
  const [cancelState, cancelAction, cancelling] = useActionState(
    unregisterFromDrive,
    initialProfileActionState
  );

  if (!isDonor) {
    return (
      <Alert variant="info" title="Registration is for donors">
        Switch to a donor account to register for a campus blood drive. If you
        cannot donate, please share the drive with someone who can — drives need
        donors, not attendees.
      </Alert>
    );
  }

  // A withdrawn registration is terminal by design: re-registering would make
  // the roster churn on the day and could be used to game attendance counts.
  if (status === "cancelled") {
    return (
      <Alert variant="warning" title="You withdrew from this drive">
        Your registration was cancelled and cannot be reopened here. Contact the
        organisers directly if you would like to take part after all.
      </Alert>
    );
  }

  if (status === "checked_in" || status === "participated") {
    return (
      <Alert variant="success" title="You are on the list">
        {status === "checked_in"
          ? "You are checked in for this drive. Please speak to a volunteer if anything changes."
          : "Thank you for taking part in this drive."}
      </Alert>
    );
  }

  if (status === "registered") {
    return (
      <div className="space-y-3">
        <Alert variant="success" title="You are registered">
          Bring a photo ID. Registration is an expression of interest — the
          organisers and blood bank decide who can donate on the day.
        </Alert>
        {openForRegistration && (
          <form action={cancelAction}>
            <input type="hidden" name="driveId" value={driveId} />
            <Button type="submit" variant="secondary" disabled={cancelling}>
              {cancelling ? "Withdrawing…" : "I can no longer attend"}
            </Button>
          </form>
        )}
        {cancelState.error && (
          <p role="alert" className="text-sm font-medium text-red-600">
            {cancelState.error}
          </p>
        )}
      </div>
    );
  }

  if (!openForRegistration) {
    return (
      <Alert variant="info" title="Registration has closed">
        This drive is no longer accepting registrations. Check the notification
        centre for any change to the schedule.
      </Alert>
    );
  }

  return (
    <form action={registerAction} className="space-y-4">
      {registerState.error && <Alert variant="error">{registerState.error}</Alert>}
      <input type="hidden" name="driveId" value={driveId} />
      <Input
        label="Anything the organisers should know? (optional)"
        name="note"
        type="text"
        maxLength={DRIVE_REGISTRATION_NOTE_MAX}
        placeholder="e.g. I can only make it for the first two hours."
        disabled={registering}
      />
      <p className="text-sm text-ink-600">
        Leave your phone number out — the organisers reach you through RaktSetu
        notifications only.
      </p>
      <Button type="submit" disabled={registering}>
        {registering ? "Registering…" : "Register for this drive"}
      </Button>
    </form>
  );
}
