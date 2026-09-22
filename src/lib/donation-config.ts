/**
 * Central donation-interval configuration.
 *
 * ⚠️ IMPORTANT: This interval is an APPLICATION-LEVEL AVAILABILITY FILTER
 * only. It is NOT a medical eligibility rule. Final eligibility is always
 * determined by the blood bank / medical screening.
 *
 * The current default (90 days for whole blood) must be verified with an
 * authorized blood bank or Red Cross professional before production use.
 * Update it here — nowhere else — when that verification happens.
 *
 * The database mirrors this interval in a single place:
 * supabase/migrations/0003_donor_matching.sql → donor_is_currently_eligible().
 * Keep the two in sync when updating.
 */
export const DONATION_INTERVAL_DAYS = 90;

/** Human-readable explanation shown to donors. */
export const DONATION_INTERVAL_LABEL = "90 days";

export const ELIGIBILITY_DISCLAIMER =
  "RaktSetu never decides medical eligibility. This date is an availability filter only — final eligibility is always determined by the blood bank's medical screening.";
