"use client";

import { useActionState, useState, type FormEvent } from "react";

import { createBloodRequest } from "@/lib/actions/requests";
import { lookupAreaCandidates } from "@/lib/actions/location";
import {
  initialLocationLookupState,
  type LocationLookupState,
} from "@/lib/actions/location-state";
import { initialProfileActionState } from "@/lib/actions/action-state";
import {
  BLOOD_GROUPS,
  BLOOD_COMPONENTS,
  URGENCY_OPTIONS,
  MIN_UNITS,
  MAX_UNITS,
  REQUEST_NOTE_MAX,
} from "@/lib/constants";
import { bloodRequestFieldErrors, type BloodRequestFieldInput } from "@/lib/validation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";

function defaultDeadline(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * THE ENTIRE FORM, in ONE piece of state.
 *
 * WHY THE FORM OWNS ITS VALUES INSTEAD OF LEAVING THEM UNCONTROLLED
 *
 * The fields used to be uncontrolled (`defaultValue`, read back through
 * FormData). Uncontrolled inputs survive a rerender, so this was never
 * obviously broken — but they are reset by anything that re-submits the form,
 * and this form has a SECOND action on it: the area lookup. Submitting that
 * lookup re-submits the same `<form>`, and React resets the form's fields
 * around a form action. That is why typing an area and then pressing the lookup
 * button silently emptied the blood group, units, urgency and deadline that had
 * already been entered — and why the optional section, which wraps that button,
 * looked like it "ate" the form whenever it was opened.
 *
 * So the values live in React state and every input is controlled. That makes
 * them immune to re-submission, to a remount of anything below this component,
 * and to any rerender. `defaultDeadline()` is computed ONCE in the lazy
 * initialiser below: previously it was evaluated on every render, which also
 * re-based the deadline under the user as they filled the form in.
 */
interface RequestFormValues extends BloodRequestFieldInput {
  /** Approximate area coordinates, when the user picks a lookup result. */
  latitude: number | null;
  longitude: number | null;
}

function initialValues(contactName: string): RequestFormValues {
  return {
    bloodGroup: "",
    bloodComponent: "whole_blood",
    units: "1",
    locality: "",
    urgency: "urgent",
    requiredBy: defaultDeadline(),
    contactName,
    contactPhone: "",
    note: "",
    latitude: null,
    longitude: null,
  };
}


/**
 * Emergency-first blood request form. Large labels, big controls, one
 * obvious primary action. Invalid or incomplete submissions are caught in
 * the browser first (same validators as the server, field-by-field, with
 * focus moved to the first problem); the server action then re-validates
 * everything before touching the database.
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
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  // Lazy initialiser: the defaults are computed once per mount, never per render.
  const [values, setValues] = useState<RequestFormValues>(() => initialValues(contactName));
  /** The area the user picked from a lookup, kept out of the submitted fields. */
  const [pickedArea, setPickedArea] = useState<{ label: string; lat: number; lng: number } | null>(
    null,
  );

  /**
   * Merge ONE field. Never `setValues(next)`, which would discard every other
   * value the user has typed — the exact failure this form had.
   */
  function setField<K extends keyof RequestFormValues>(field: K, value: RequestFormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  /** Clear a field's error as soon as the user edits it, but never the value. */
  function onEdit<K extends keyof BloodRequestFieldInput>(field: K, value: string) {
    setField(field, value as RequestFormValues[K]);
    setClientErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  /** Pre-submit validation — blocks the server round trip when invalid. */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // The area-lookup button lives on this same form and submits through its own
    // action. Its submission must NOT be validated as a request submission, or a
    // half-finished form could never be used to look up its area.
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    if (submitter?.dataset.lookup === "true") return;

    // Read from STATE, not from FormData: state is the single source of truth,
    // so what is validated is exactly what is displayed and submitted.
    const errors = bloodRequestFieldErrors({
      bloodGroup: values.bloodGroup,
      bloodComponent: values.bloodComponent,
      units: values.units,
      locality: values.locality,
      urgency: values.urgency,
      requiredBy: values.requiredBy,
      contactName: values.contactName,
      contactPhone: values.contactPhone,
      note: values.note,
    });
    setClientErrors(errors);

    const firstField = Object.keys(errors)[0];
    if (firstField) {
      event.preventDefault();
      const field = event.currentTarget.elements.namedItem(firstField);
      if (field instanceof HTMLElement) field.focus();
    }
  }

  const clientErrorCount = Object.keys(clientErrors).length;

  return (
    <form action={formAction} onSubmit={handleSubmit} className="space-y-8" noValidate>
      {state.error && <Alert variant="error">{state.error}</Alert>}
      {state.success && <Alert variant="success">{state.success}</Alert>}
      {clientErrorCount > 0 && (
        <Alert variant="error" title="Please check the highlighted fields">
          {clientErrorCount === 1
            ? clientErrors[Object.keys(clientErrors)[0]]
            : `${clientErrorCount} fields need attention before this request can be sent.`}
        </Alert>
      )}
      <p className="text-sm text-ink-600">
        Fields marked <span className="font-bold text-blood-700">*</span> are
        required — only the additional note is optional.
      </p>

      <div className="grid gap-6 sm:grid-cols-2">
        <Select
          label="Blood group needed"
          name="bloodGroup"
          required
          requiredMark
          disabled={pending}
          value={values.bloodGroup}
          onChange={(e) => onEdit("bloodGroup", e.target.value)}
          error={clientErrors.bloodGroup}
        >
          <option value="" disabled>
            Select blood group
          </option>
          {BLOOD_GROUPS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>

        <Select
          label="Component"
          name="bloodComponent"
          required
          requiredMark
          disabled={pending}
          value={values.bloodComponent}
          onChange={(e) => onEdit("bloodComponent", e.target.value)}
          error={clientErrors.bloodComponent}
        >
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
          required
          requiredMark
          disabled={pending}
          value={values.units}
          onChange={(e) => onEdit("units", e.target.value)}
          error={clientErrors.units}
        />

        <Select
          label="How urgent is it?"
          name="urgency"
          required
          requiredMark
          disabled={pending}
          value={values.urgency}
          onChange={(e) => onEdit("urgency", e.target.value)}
          error={clientErrors.urgency}
        >
          {URGENCY_OPTIONS.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label} — {u.description}
            </option>
          ))}
        </Select>
      </div>

      <Input
        label="Blood needed near"
        name="locality"
        placeholder="e.g. Indiranagar, Bengaluru"
        maxLength={100}
        required
        requiredMark
        disabled={pending}
        hint="The general locality or area where the patient needs blood. Not a hospital name and not a home address."
        value={values.locality}
        onChange={(e) => {
          onEdit("locality", e.target.value);
          // Editing the area invalidates a previously picked map point, so the
          // coordinates are cleared — but only the coordinates, never the text
          // the user is still typing.
          setPickedArea(null);
          setField("latitude", null);
          setField("longitude", null);
        }}
        error={clientErrors.locality}
      />

      <Input
        label="Required by"
        name="requiredBy"
        type="datetime-local"
        required
        requiredMark
        disabled={pending}
        value={values.requiredBy}
        onChange={(e) => onEdit("requiredBy", e.target.value)}
        error={clientErrors.requiredBy}
        hint="Must be in the future and within 30 days. Alerts to donors start as soon as the request is created."
      />

      {/*
        The area lookup. It is a SECOND action on this form, which is what used to
        wipe it: submitting it re-submitted the form and React reset the fields.
        The values now live in React state, so a reset of the DOM inputs cannot
        lose anything — the very next render restores them from state.
      */}
      <details className="rounded-md border border-ink-200 bg-ink-50 p-5">
        <summary className="cursor-pointer text-base font-bold text-ink-900">
          Pin this area on the map (optional)
        </summary>
        <p className="mt-3 text-sm text-ink-600">
          This helps us estimate roughly how far donors are from the area above.
          RaktSetu stores only a rough point (about 1 km) — never a street
          address. Skip it and matching still works using the locality text.
        </p>

        <div className="mt-4">
          <Button
            type="submit"
            formAction={lookupAction}
            formNoValidate
            variant="secondary"
            data-lookup="true"
            disabled={lookupPending}
          >
            {lookupPending ? "Checking…" : "Find my area"}
          </Button>
        </div>

        {lookup.error && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-600">
            {lookup.error}
          </p>
        )}

        {pickedArea && (
          <p role="status" className="mt-3 text-sm font-medium text-green-700">
            Area set to: {pickedArea.label}
          </p>
        )}

        {lookup.candidates.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-semibold text-ink-900">
              Pick the closest match for your area:
            </p>
            {lookup.candidates.map((c) => (
              <label
                key={`${c.lat}:${c.lng}`}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-ink-200 bg-white px-4 py-3 hover:bg-ink-50"
              >
                <input
                  type="radio"
                  name="coordsChoice"
                  checked={pickedArea?.lat === c.lat && pickedArea?.lng === c.lng}
                  onChange={() => {
                    // Merge ONLY the coordinates. Nothing else in the form is
                    // touched, so the blood group, units, deadline and contact
                    // details the user already entered all survive.
                    setField("latitude", c.lat);
                    setField("longitude", c.lng);
                    setPickedArea({ label: c.label, lat: c.lat, lng: c.lng });
                  }}
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
            maxLength={80}
            required
            requiredMark
            disabled={pending}
            value={values.contactName}
            onChange={(e) => onEdit("contactName", e.target.value)}
            error={clientErrors.contactName}
          />
          <Input
            label="Contact phone"
            name="contactPhone"
            type="tel"
            placeholder="e.g. +91 98765 43210"
            required
            requiredMark
            disabled={pending}
            value={values.contactPhone}
            onChange={(e) => onEdit("contactPhone", e.target.value)}
            error={clientErrors.contactPhone}
          />
        </div>
      </fieldset>

      <Textarea
        label="Additional note (optional)"
        name="note"
        maxLength={REQUEST_NOTE_MAX}
        rows={3}
        placeholder="Anything a donor should know — e.g. timings or how to coordinate."
        disabled={pending}
        value={values.note}
        onChange={(e) => onEdit("note", e.target.value)}
        error={clientErrors.note}
      />

      {/*
        The picked area travels as hidden fields so the server receives it
        without the user re-typing anything. Absent means "no coordinates", which
        is valid: matching then works on the locality text alone.
      */}
      <input type="hidden" name="latitude" value={values.latitude ?? ""} />
      <input type="hidden" name="longitude" value={values.longitude ?? ""} />

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
