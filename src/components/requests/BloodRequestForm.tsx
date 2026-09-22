"use client";

import { useActionState } from "react";

import { createBloodRequest } from "@/lib/actions/requests";
import {
  initialLocationLookupState,
  lookupAreaCandidates,
  type LocationLookupState,
} from "@/lib/actions/location";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { BLOOD_GROUPS, BLOOD_COMPONENTS, URGENCY_OPTIONS, MIN_UNITS, MAX_UNITS, REQUEST_NOTE_MAX } from "@/lib/constants";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";

function defaultDeadline(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Emergency-first blood request form. Large labels, big controls, one
 * obvious primary action. Validation errors come back from the server
 * action; the form never pretends to submit anything itself.
 */
export function BloodRequestForm({ contactName }: { contactName: string }) {
  const [state, formAction, pending] = useActionState(
    createBloodRequest,
    initialProfileActionState
  );
  const [lookup, lookupAction, lookupPending] = useActionState<LocationLookupState, FormData>(
    lookupAreaCandidates,
    initialLocationLookupState
  );

  return (
    <form action={formAction} className="space-y-8" noValidate>
      {state.error && <Alert variant="error">{state.error}</Alert>}
      {state.success && <Alert variant="success">{state.success}</Alert>}

      <div className="grid gap-6 sm:grid-cols-2">
        <Select label="Blood group needed" name="bloodGroup" required disabled={pending} defaultValue="">
          <option value="" disabled>
            Select blood group
          </option>
          {BLOOD_GROUPS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>

        <Select label="Component" name="bloodComponent" required disabled={pending} defaultValue="whole_blood">
          {BLOOD_COMPONENTS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Input
          label="Units needed"
          name="units"
          type="number"
          min={MIN_UNITS}
          max={MAX_UNITS}
          defaultValue={1}
          required
          disabled={pending}
        />

        <Select label="How urgent is it?" name="urgency" required disabled={pending} defaultValue="urgent">
          {URGENCY_OPTIONS.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label} — {u.description}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Input
          label="Hospital name"
          name="hospitalName"
          placeholder="e.g. St. Martha's Hospital"
          maxLength={120}
          required
          disabled={pending}
        />
        <Input
          label="Hospital locality"
          name="hospitalLocality"
          placeholder="e.g. Bengaluru Central"
          maxLength={120}
          required
          disabled={pending}
        />
      </div>

      <Input
        label="Required by"
        name="requiredBy"
        type="datetime-local"
        defaultValue={defaultDeadline()}
        required
        disabled={pending}
      />

      <details className="rounded-md border border-ink-200 bg-ink-50 p-5">
        <summary className="cursor-pointer text-base font-bold text-ink-900">
          Hospital map location (optional)
        </summary>
        <p className="mt-3 text-sm text-ink-600">
          This helps us estimate how far donors are from the hospital. RaktSetu stores
          only a rough point (about 1 km) — never a street address. If you skip this, we
          try a best-effort lookup from the hospital details above, and matching still
          works either way.
        </p>

        <div className="mt-4">
          <Button
            type="submit"
            formAction={lookupAction}
            formNoValidate
            variant="secondary"
            disabled={lookupPending}
          >
            {lookupPending ? "Checking…" : "Check hospital location"}
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
              Pick the closest match for the hospital area:
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
          </div>
        )}
      </details>

      <fieldset className="rounded-md border border-ink-200 bg-ink-50 p-5">
        <legend className="px-2 text-base font-bold text-ink-900">
          How can donors reach you?
        </legend>
        <p className="mb-5 text-sm text-ink-600">
          Your phone number is never public. It is shared with a donor only if you later
          confirm them for this request.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          <Input
            label="Contact name"
            name="contactName"
            defaultValue={contactName}
            maxLength={80}
            required
            disabled={pending}
          />
          <Input
            label="Contact phone"
            name="contactPhone"
            type="tel"
            placeholder="e.g. +91 98765 43210"
            required
            disabled={pending}
          />
        </div>
      </fieldset>

      <Textarea
        label="Additional note (optional)"
        name="note"
        maxLength={REQUEST_NOTE_MAX}
        rows={3}
        placeholder="Anything a donor should know — e.g. ward name, timings."
        disabled={pending}
      />

      <div className="border-t border-ink-200 pt-6">
        <Button type="submit" disabled={pending} className="w-full sm:w-auto sm:min-w-72">
          {pending ? "Creating request…" : "Create request"}
        </Button>
        <p className="mt-3 text-sm text-ink-600">
          RaktSetu is a coordination tool, not an emergency service. For immediate
          emergencies, contact your hospital or emergency services first.
        </p>
      </div>
    </form>
  );
}
