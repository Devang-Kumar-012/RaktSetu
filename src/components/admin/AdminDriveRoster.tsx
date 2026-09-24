"use client";

import { useActionState } from "react";

import { recordDriveDonation, setDriveAttendance } from "@/lib/actions/drives";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import {
  BLOOD_COMPONENTS,
  DRIVE_REGISTRATION_STATUS_LABELS,
} from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import type { DriveRegistration } from "@/types";

/**
 * Attendance check-in for ONE registered donor. Admin or active volunteer.
 *
 * The donor reference comes from the roster row, never a hand-typed id, and the
 * database's one-way transition guard rejects anything that is not a legal
 * forward move — so this button cannot invent a participation for someone who
 * never attended.
 */
export function AttendanceControl({
  driveId,
  registration,
}: {
  driveId: string;
  registration: DriveRegistration;
}) {
  const [state, formAction, pending] = useActionState(
    setDriveAttendance,
    initialProfileActionState
  );

  if (registration.status === "participated" || registration.status === "cancelled") {
    return (
      <span className="text-sm font-semibold text-ink-600">
        {DRIVE_REGISTRATION_STATUS_LABELS[registration.status]}
      </span>
    );
  }

  const next = registration.status === "registered" ? "checked_in" : "participated";
  return (
    <div className="space-y-2">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="driveId" value={driveId} />
        <input type="hidden" name="donorId" value={registration.donor_id} />
        <input type="hidden" name="status" value={next} />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : next === "checked_in" ? "Check in" : "Mark as took part"}
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

/**
 * Donation recording for ONE registered donor. ADMIN ONLY.
 *
 * Deliberately a separate, heavier control than check-in: a donation record
 * starts the donor's availability interval, so asserting one is an
 * administrative act, not a check-in scan. It writes to the EXISTING
 * donation_history ledger, so the donor's cooldown and donation count update
 * through the same trigger an emergency donation already uses.
 *
 * The wording never claims medical eligibility — the blood bank decides that,
 * and this only records that a donation was collected.
 */
function DonationControl({
  driveId,
  registration,
}: {
  driveId: string;
  registration: DriveRegistration;
}) {
  const [state, formAction, pending] = useActionState(
    recordDriveDonation,
    initialProfileActionState
  );

  return (
    <form action={formAction} className="space-y-3 rounded-md border border-ink-200 p-4">
      <input type="hidden" name="driveId" value={driveId} />
      <input type="hidden" name="donorId" value={registration.donor_id} />
      {state.error && <Alert variant="error">{state.error}</Alert>}
      {state.success && <Alert variant="success">{state.success}</Alert>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          label="Donation date"
          name="donatedOn"
          type="date"
          required
          max={new Date().toISOString().slice(0, 10)}
          defaultValue={new Date().toISOString().slice(0, 10)}
          disabled={pending}
        />
        <Select label="Component" name="bloodComponent" defaultValue="whole_blood" disabled={pending}>
          {BLOOD_COMPONENTS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        <Input
          label="Units"
          name="units"
          type="number"
          min={1}
          max={10}
          defaultValue={1}
          disabled={pending}
        />
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Recording…" : "Record donation"}
      </Button>
    </form>
  );
}

/**
 * The drive roster for admins: who registered, their state, and the two
 * operational actions.
 *
 * Shows a donor reference and a state — never a phone number, e-mail, locality
 * or coordinates. Those stay in donor_profiles behind their own row-level
 * security, and this component never selects them, so a volunteer checking
 * people in learns nothing private. A donor's optional note IS shown, because
 * they wrote it for the organisers.
 */
export function AdminDriveRoster({
  driveId,
  registrations,
  donationsByDonor,
  canRecordDonations,
  driveClosed,
}: {
  driveId: string;
  registrations: DriveRegistration[];
  /** donor_id -> the donation already recorded at this drive, if any. */
  donationsByDonor: Map<
    string,
    { units: number; component: string | null; donated_on: string }
  >;
  canRecordDonations: boolean;
  driveClosed: boolean;
}) {
  if (registrations.length === 0) {
    return (
      <p className="text-base text-ink-600">
        Nobody has registered yet. Publish the drive and share the link — donors
        register from the drive page.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {registrations.map((r) => {
        const donation = donationsByDonor.get(r.donor_id);
        return (
          <article key={r.id} className="rounded-lg border border-ink-200 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-sm text-ink-600">{r.donor_id.slice(0, 8)}…</p>
                <p className="mt-1 text-sm text-ink-600">
                  Registered {formatDateTime(r.registered_at)}
                </p>
              </div>
              <span className="rounded-md bg-ink-100 px-3 py-1 text-sm font-bold text-ink-700">
                {DRIVE_REGISTRATION_STATUS_LABELS[r.status]}
              </span>
            </div>

            {r.note && (
              <p className="mt-3 rounded-md bg-ink-50 px-4 py-3 text-sm text-ink-800">
                {r.note}
              </p>
            )}

            {donation && (
              <p className="mt-3 text-sm font-semibold text-green-700">
                Donation recorded — {donation.units}{" "}
                {donation.units === 1 ? "unit" : "units"} on {donation.donated_on}.
              </p>
            )}

            {!driveClosed && (
              <div className="mt-4 space-y-4">
                <AttendanceControl driveId={driveId} registration={r} />
                {canRecordDonations && !donation && (
                  <DonationControl driveId={driveId} registration={r} />
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

