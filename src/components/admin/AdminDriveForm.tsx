"use client";

import { useActionState } from "react";

import { createCampusDrive, updateCampusDrive } from "@/lib/actions/drives";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import {
  DRIVE_DESCRIPTION_MAX,
  DRIVE_ORGANIZER_MAX,
  DRIVE_STATUS_OPTIONS,
  DRIVE_TARGET_BOUNDS,
  DRIVE_TITLE_MAX,
} from "@/lib/constants";
import type { CampusDrive } from "@/types";

/** ISO -> the `datetime-local` value the browser expects, in IST. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/**
 * Admin create/edit form for a campus blood drive.
 *
 * One component serves both, so the validation and field set cannot drift
 * between "create" and "edit". The server action re-validates everything; the
 * browser-side `min`/`max` are only convenience.
 *
 * Times are entered and displayed in IST to match how a campus actually
 * schedules a drive, and the database CHECK independently guarantees the drive
 * ends after it starts.
 */
export function AdminDriveForm({ drive = null }: { drive?: CampusDrive | null }) {
  const [createState, createAction, creating] = useActionState(
    createCampusDrive,
    initialProfileActionState
  );
  const [updateState, updateAction, updating] = useActionState(
    updateCampusDrive,
    initialProfileActionState
  );

  const editing = drive !== null;
  const state = editing ? updateState : createState;
  const pending = editing ? updating : creating;
  const action = editing ? updateAction : createAction;

  return (
    <form action={action} className="space-y-6">
      {state.error && <Alert variant="error">{state.error}</Alert>}
      {state.success && <Alert variant="success">{state.success}</Alert>}

      {editing && <input type="hidden" name="driveId" value={drive.id} />}

      <Input
        label="Drive title"
        name="title"
        type="text"
        required
        maxLength={DRIVE_TITLE_MAX}
        defaultValue={drive?.title ?? ""}
        placeholder="e.g. Annual Blood Donation Camp"
        disabled={pending}
        requiredMark
      />
      <Input
        label="Organising college or organisation"
        name="organizer"
        type="text"
        required
        maxLength={DRIVE_ORGANIZER_MAX}
        defaultValue={drive?.organizer ?? ""}
        placeholder="e.g. RaktSetu College, Department of Social Work"
        disabled={pending}
        requiredMark
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Starts (IST)"
          name="startsAt"
          type="datetime-local"
          required
          defaultValue={drive ? toLocalInput(drive.starts_at) : ""}
          disabled={pending}
          requiredMark
        />
        <Input
          label="Ends (IST)"
          name="endsAt"
          type="datetime-local"
          required
          defaultValue={drive ? toLocalInput(drive.ends_at) : ""}
          disabled={pending}
          requiredMark
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Venue"
          name="venue"
          type="text"
          required
          maxLength={DRIVE_ORGANIZER_MAX}
          defaultValue={drive?.venue ?? ""}
          placeholder="e.g. College main auditorium"
          disabled={pending}
          requiredMark
        />
        <Input
          label="Locality"
          name="locality"
          type="text"
          required
          maxLength={120}
          defaultValue={drive?.locality ?? ""}
          placeholder="e.g. Indiranagar"
          disabled={pending}
          requiredMark
        />
      </div>

      <Input
        label="Target units to collect (optional)"
        name="targetUnits"
        type="number"
        min={DRIVE_TARGET_BOUNDS.min}
        max={DRIVE_TARGET_BOUNDS.max}
        defaultValue={drive?.target_units ?? ""}
        hint="Leave blank if the organisers have not set a target."
        disabled={pending}
      />

      <Select
        label="Status"
        name="status"
        defaultValue={drive?.status ?? "upcoming"}
        disabled={pending}
        hint="Cancelling tells every registered donor. Completing thanks them and closes the roster."
        requiredMark
      >
        {DRIVE_STATUS_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>

      <Textarea
        label="Instructions for donors (optional)"
        name="description"
        rows={4}
        maxLength={DRIVE_DESCRIPTION_MAX}
        defaultValue={drive?.description ?? ""}
        placeholder="What to bring, timings for walk-ins, who to contact on the day."
        disabled={pending}
      />

      {editing && !drive.published && (
        <label className="flex items-center gap-3 text-base text-ink-900">
          <input type="checkbox" name="publishNow" disabled={updating} className="h-5 w-5" />
          Publish this drive so donors can register
        </label>
      )}

      <Button type="submit" disabled={pending}>
        {pending
          ? "Saving…"
          : editing
            ? "Save drive"
            : "Create drive (as draft)"}
      </Button>
    </form>
  );
}
