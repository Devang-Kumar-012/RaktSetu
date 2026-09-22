"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { updateDonorProfile } from "@/lib/actions/donor";
import {
  initialLocationLookupState,
  lookupAreaCandidates,
  type LocationLookupState,
} from "@/lib/actions/location";
import { DONATION_INTERVAL_LABEL } from "@/lib/donation-config";
import { AVAILABILITY_OPTIONS, BLOOD_GROUPS } from "@/lib/constants";
import { cn } from "@/lib/cn";
import type { DonorProfile } from "@/types";

export function DonorProfileForm({ donor }: { donor: DonorProfile | null }) {
  const [state, formAction, pending] = useActionState(
    updateDonorProfile,
    initialProfileActionState
  );
  const [lookup, lookupAction, lookupPending] = useActionState<LocationLookupState, FormData>(
    lookupAreaCandidates,
    initialLocationLookupState
  );

  const today = new Date().toISOString().slice(0, 10);
  const hasStoredLocation =
    donor?.latitude !== null && donor?.latitude !== undefined &&
    donor?.longitude !== null && donor?.longitude !== undefined;

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {state.error && <Alert variant="error">{state.error}</Alert>}
      {state.success && <Alert variant="success">{state.success}</Alert>}

      <div className="grid gap-6 sm:grid-cols-2">
        <Select
          label="Blood group"
          name="bloodGroup"
          defaultValue={donor?.blood_group ?? ""}
          required
          disabled={pending}
        >
          <option value="" disabled>
            Select blood group
          </option>
          {BLOOD_GROUPS.map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
        </Select>

        <Input
          label="Locality"
          name="locality"
          type="text"
          defaultValue={donor?.locality ?? ""}
          placeholder="e.g. Indiranagar, Bengaluru"
          hint="General area only — never your exact home address."
          maxLength={100}
          required
          disabled={pending}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Input
          label="Phone number"
          name="phone"
          type="tel"
          autoComplete="tel"
          defaultValue={donor?.phone ?? ""}
          placeholder="+91 98xxxxxx21"
          hint="Private. Other users never see it — it would only ever be shared after you accept a blood request."
          required
          disabled={pending}
        />

        <Input
          label="Last donation date"
          name="lastDonationDate"
          type="date"
          defaultValue={donor?.last_donation_date ?? ""}
          max={today}
          hint={`Optional. Leave empty if you have never donated. After a donation, matching pauses automatically for the ${DONATION_INTERVAL_LABEL} interval.`}
          disabled={pending}
        />
      </div>

      <fieldset className="rounded-md border border-ink-200 bg-ink-50 p-5">
        <legend className="px-2 text-base font-bold text-ink-900">Your location</legend>

        <p className="mb-4 text-sm text-ink-600">
          {hasStoredLocation
            ? "An approximate map location is saved. You can change or remove it below."
            : "No map location saved yet — matching still works with your locality text, just without distance sorting."}
        </p>

        <div className="flex flex-wrap items-end gap-4">
          <Button
            type="submit"
            formAction={lookupAction}
            formNoValidate
            variant="secondary"
            disabled={lookupPending}
          >
            {lookupPending ? "Looking up…" : "Find my area from the locality above"}
          </Button>
        </div>

        {lookup.error && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-600">
            {lookup.error}
          </p>
        )}

        {lookup.candidates.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-semibold text-ink-900">
              Pick the closest match — we store only a rough point (about 1 km):
            </p>
            {lookup.candidates.map((c) => (
              <label
                key={`${c.lat}:${c.lng}`}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-ink-200 bg-white px-4 py-3 hover:bg-ink-50"
              >
                <input
                  type="radio"
                  name="coordsChoice"
                  value={`${c.lat}:${c.lng}`}
                  disabled={pending}
                  className="mt-1.5 h-4 w-4 accent-blood-700"
                />
                <span className="text-sm text-ink-800">{c.label}</span>
              </label>
            ))}
            <p className="text-sm text-ink-600">
              Then press “Save donor profile” below to store it.
            </p>
          </div>
        )}

        <p className="mt-4 text-sm text-ink-600">
          What RaktSetu keeps: your locality name and, if you pick one above, a rough map
          point rounded to about 1 km. Requesters never see it — it is only used to
          estimate how far a hospital is from you. No home address, ever.
        </p>
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 block text-base font-semibold text-ink-900">
          Availability
        </legend>
        <div className="space-y-2">
          {AVAILABILITY_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3",
                (donor?.availability ?? "temporarily_unavailable") === option.value
                  ? "border-blood-600 bg-blood-50"
                  : "border-ink-200 bg-white hover:bg-ink-50"
              )}
            >
              <input
                type="radio"
                name="availability"
                value={option.value}
                defaultChecked={
                  (donor?.availability ?? "temporarily_unavailable") === option.value
                }
                disabled={pending}
                className="mt-1.5 h-4 w-4 accent-blood-700"
              />
              <span>
                <span className="block font-semibold text-ink-900">{option.label}</span>
                <span className="block text-sm text-ink-600">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {donor && (
        <p className="text-base text-ink-600">
          Recorded donations: <strong className="text-ink-900">{donor.donation_count}</strong>{" "}
          — updated by coordinators, not editable here.
        </p>
      )}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : donor ? "Save donor profile" : "Create donor profile"}
      </Button>

      <p className="text-sm text-ink-400">
        RaktSetu never decides medical eligibility — final screening is always done by
        the blood bank.
      </p>
    </form>
  );
}
