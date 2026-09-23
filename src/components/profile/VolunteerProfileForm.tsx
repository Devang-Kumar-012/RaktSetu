"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { updateVolunteerProfile } from "@/lib/actions/volunteer";
import { AVAILABILITY_OPTIONS } from "@/lib/constants";
import { cn } from "@/lib/cn";
import type { VolunteerProfile } from "@/types";

export function VolunteerProfileForm({ volunteer }: { volunteer: VolunteerProfile | null }) {
  const [state, formAction, pending] = useActionState(
    updateVolunteerProfile,
    initialProfileActionState
  );

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {state.error && <Alert variant="error">{state.error}</Alert>}
      {state.success && <Alert variant="success">{state.success}</Alert>}

      <Input
        label="Phone (optional, private)"
        name="phone"
        type="tel"
        defaultValue={volunteer?.phone ?? ""}
        placeholder="e.g. +91 98765 43210"
        hint="Only you and platform administrators can see this. Never shown to requesters or donors."
        maxLength={20}
        disabled={pending}
      />

      <Input
        label="Locality (optional)"
        name="locality"
        type="text"
        defaultValue={volunteer?.locality ?? ""}
        placeholder="e.g. Indiranagar, Bengaluru"
        hint="General area only — never your exact home address."
        maxLength={100}
        disabled={pending}
      />

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
                (volunteer?.availability ?? "temporarily_unavailable") === option.value
                  ? "border-blood-600 bg-blood-50"
                  : "border-ink-200 bg-white hover:bg-ink-50"
              )}
            >
              <input
                type="radio"
                name="availability"
                value={option.value}
                defaultChecked={
                  (volunteer?.availability ?? "temporarily_unavailable") === option.value
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

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : volunteer ? "Save volunteer profile" : "Create volunteer profile"}
      </Button>
    </form>
  );
}
