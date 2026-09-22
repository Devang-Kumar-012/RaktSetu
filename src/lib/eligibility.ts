import { DONATION_INTERVAL_DAYS, DONATION_INTERVAL_LABEL } from "@/lib/donation-config";
import type { DonorProfile } from "@/types";

/**
 * Application-level eligibility states for the donor availability system.
 * "not_currently_eligible" means the donation interval has not passed since
 * the last donation — an availability filter, never a medical judgement.
 */
export type DonorMatchingStatus =
  | "available"
  | "temporarily_unavailable"
  | "not_currently_eligible";

export interface DonorEligibility {
  /** Combined status used for dashboard display and (future) matching. */
  status: DonorMatchingStatus;
  /** null when no last donation date is on record. */
  nextEligibleDate: string | null;
  /** Days until the calculated next eligible date; 0 when already eligible. */
  daysUntilEligible: number;
  /** Formatted date or "—". */
  nextEligibleLabel: string;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatLabel(dateKey: string | null): string {
  if (!dateKey) return "—";
  const d = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Computes the donor's combined availability/eligibility status.
 *
 * Order of precedence:
 *   1. The donor manually paused themselves → "temporarily_unavailable".
 *   2. The donation interval since the last donation has not passed →
 *      "not_currently_eligible".
 *   3. Otherwise → "available".
 */
export function getDonorEligibility(
  donor: Pick<DonorProfile, "availability" | "last_donation_date"> | null
): DonorEligibility {
  if (!donor) {
    return {
      status: "temporarily_unavailable",
      nextEligibleDate: null,
      daysUntilEligible: 0,
      nextEligibleLabel: "—",
    };
  }

  if (donor.availability === "temporarily_unavailable") {
    return {
      status: "temporarily_unavailable",
      nextEligibleDate: null,
      daysUntilEligible: 0,
      nextEligibleLabel: "—",
    };
  }

  if (donor.last_donation_date) {
    const last = new Date(`${donor.last_donation_date}T00:00:00Z`);
    if (!Number.isNaN(last.getTime())) {
      const next = addDays(last, DONATION_INTERVAL_DAYS);
      const nextKey = toDateKey(next);
      const todayKey = toDateKey(new Date());
      const daysRemaining = Math.max(
        0,
        Math.ceil((next.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      );

      if (nextKey > todayKey) {
        return {
          status: "not_currently_eligible",
          nextEligibleDate: nextKey,
          daysUntilEligible: daysRemaining,
          nextEligibleLabel: formatLabel(nextKey),
        };
      }
    }
  }

  return {
    status: "available",
    nextEligibleDate: null,
    daysUntilEligible: 0,
    nextEligibleLabel: "—",
  };
}

/** Badge styling + copy for each status, shared by dashboard pages. */
export const DONOR_STATUS_META: Record<
  DonorMatchingStatus,
  { label: string; className: string; description: string }
> = {
  available: {
    label: "Available",
    className: "bg-green-50 text-green-900 border border-green-200",
    description: `You can be matched when a nearby request needs your blood group (after the ${DONATION_INTERVAL_LABEL} interval, where applicable).`,
  },
  temporarily_unavailable: {
    label: "Temporarily unavailable",
    className: "bg-amber-50 text-amber-900 border border-amber-200",
    description:
      "You paused matching yourself. Switch back to available in your donor profile when ready.",
  },
  not_currently_eligible: {
    label: "Not currently eligible",
    className: "bg-ink-100 text-ink-600 border border-ink-200",
    description: `Your last donation was recent. Based on the ${DONATION_INTERVAL_LABEL} interval, you will automatically return to matching on your next eligible date.`,
  },
};

/** Profile completion for the donor dashboard. */
export function getDonorProfileCompletion(
  donor: DonorProfile | null
): { complete: boolean; missing: string[]; percent: number } {
  if (!donor) {
    return { complete: false, missing: ["donor profile"], percent: 0 };
  }

  const missing: string[] = [];
  if (!donor.blood_group) missing.push("blood group");
  if (!donor.locality) missing.push("locality");
  if (!donor.phone) missing.push("phone number");
  // last_donation_date is optional; availability always has a value.

  const filled = 4 - missing.length;
  return {
    complete: missing.length === 0,
    missing,
    percent: Math.round((filled / 4) * 100),
  };
}
