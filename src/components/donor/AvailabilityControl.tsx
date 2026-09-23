"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { updateDonorProfile } from "@/lib/actions/donor";
import { cn } from "@/lib/cn";
import { DONATION_INTERVAL_LABEL } from "@/lib/donation-config";
import { AVAILABILITY_OPTIONS } from "@/lib/constants";
import { getDonorEligibility } from "@/lib/eligibility";
import type { DonorProfile } from "@/types";

/**
 * Dashboard availability control: the donor switches between Available and
 * Temporarily unavailable using the EXISTING updateDonorProfile server
 * action — server validation, role check, and own-row RLS all re-run; the
 * hidden profile fields are re-submitted unchanged so one action still owns
 * the whole row. "Not currently eligible" (donation-interval cooldown) is
 * displayed as status only — it is derived and can never be toggled on.
 */
export function AvailabilityControl({ donor }: { donor: DonorProfile }) {
  const [state, formAction, pending] = useActionState(
    updateDonorProfile,
    initialProfileActionState
  );
  const eligibility = getDonorEligibility(donor);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Availability</CardTitle>
      </CardHeader>
      <CardBody>
        <form action={formAction} className="space-y-4" noValidate>
          {/* This control only changes availability: every other profile
              field is re-submitted exactly as currently stored. */}
          <input type="hidden" name="bloodGroup" value={donor.blood_group} />
          <input type="hidden" name="locality" value={donor.locality} />
          <input type="hidden" name="phone" value={donor.phone} />
          <input
            type="hidden"
            name="lastDonationDate"
            value={donor.last_donation_date ?? ""}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            {AVAILABILITY_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex min-h-12 cursor-pointer items-start gap-3 rounded-md border px-4 py-3",
                  donor.availability === option.value
                    ? "border-blood-600 bg-blood-50"
                    : "border-ink-200 bg-white hover:bg-ink-50"
                )}
              >
                <input
                  type="radio"
                  name="availability"
                  value={option.value}
                  defaultChecked={donor.availability === option.value}
                  disabled={pending}
                  className="mt-1.5 h-4 w-4 accent-blood-700"
                />
                <span>
                  <span className="block font-semibold text-ink-900">
                    {option.label}
                  </span>
                  <span className="block text-sm text-ink-600">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {eligibility.status === "not_currently_eligible" && (
            <p className="text-base text-ink-600">
              <strong className="text-ink-900">Not currently eligible</strong>{" "}
              until {eligibility.nextEligibleLabel} — your last donation was
              recent, so matching stays paused for the {DONATION_INTERVAL_LABEL}{" "}
              interval no matter which option is selected above.
            </p>
          )}

          {state.error && <Alert variant="error">{state.error}</Alert>}
          {state.success && <Alert variant="success">{state.success}</Alert>}

          <div className="flex flex-wrap items-center gap-4">
            <Button
              type="submit"
              size="lg"
              disabled={pending}
              className="min-h-12"
            >
              {pending ? "Saving…" : "Save availability"}
            </Button>
            <Link
              href="/profile/donor"
              className="text-base font-semibold text-blood-700 underline hover:text-blood-800"
            >
              Edit full donor profile →
            </Link>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}