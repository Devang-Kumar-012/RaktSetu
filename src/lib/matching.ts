/**
 * Server-side donor matching — the single reusable entry point.
 *
 * Calls public.match_donors_for_request() (migration 0007), which enforces:
 *   * the request is ACTIVE and owned by the caller (or caller is admin),
 *   * donors are available and past the application cooldown (donor_directory),
 *   * donors have an active donor profile,
 *   * blood-group compatibility (whole blood / platelets),
 *   * an optional maximum radius,
 * and returns donors ordered by distance, exposing only
 * user_id / blood_group / locality / distance_km / availability /
 * cooldown_clear — never names, phones, emails, or coordinates.
 *
 * The browser cannot loosen any of this: the criteria live in the database
 * behind a SECURITY DEFINER function, and the caller is identified from the
 * session, not from the request payload.
 *
 * Kept isolated so the upcoming 3 km → 7 km → 15 km alert-ring system reuses
 * this same entry point via MATCH_RINGS_KM. Nothing here notifies anyone.
 */
import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Alert rings, in kilometres, expanded outward as a request stays open. */
export const MATCH_RINGS_KM = [3, 7, 15] as const;

/** Upper bound accepted by the database function (it clamps to this). */
export const MAX_MATCH_RADIUS_KM = 500;

export interface MatchedDonor {
  user_id: string;
  blood_group: string;
  /** General locality only — never a street address. */
  locality: string;
  /** Straight-line km to the hospital area; null when either side is unknown. */
  distance_km: number | null;
  /** Always "available" — donor_directory only yields available donors. */
  availability: string;
  /** True when the donor is past the application cooldown. */
  cooldown_clear: boolean;
}

export interface MatchOptions {
  /** Maximum straight-line distance. Omit for no cap. */
  radiusKm?: number;
  /** Max donors to return (default 50). The database caps this at 200. */
  limit?: number;
}

/** Counts used by empty states and by the future alert-ring sequence. */
export interface MatchSummary {
  /** False when the request is fulfilled, expired, or cancelled. */
  isActive: boolean;
  /** False when the hospital area has no usable coordinates. */
  hospitalHasLocation: boolean;
  /** Compatible, available, cooldown-clear donors — regardless of distance. */
  totalCompatible: number;
  /** How many of those have usable location data. */
  withLocation: number;
  within3km: number;
  within7km: number;
  within15km: number;
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Finds eligible matching donors for an active blood request, ordered by
 * distance (closest first; donors without coordinates come last).
 * Returns an empty list when the request is not active, not found, or not
 * owned by the caller — the database enforces all of this too.
 */
export async function findMatchingDonors(
  requestId: string,
  options: MatchOptions = {}
): Promise<MatchedDonor[]> {
  if (!requestId) return [];

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("match_donors_for_request", {
    p_request_id: requestId,
    p_radius_km: options.radiusKm ?? null,
    p_limit: options.limit ?? 50,
  });

  if (error) {
    console.error("findMatchingDonors failed:", error.message);
    return [];
  }

  return ((data as MatchedDonor[] | null) ?? []).map((donor) => ({
    ...donor,
    distance_km:
      donor.distance_km === null || donor.distance_km === undefined
        ? null
        : toNumber(donor.distance_km),
  }));
}

/**
 * Donor counts for a request the caller owns (or admins). Returns null when
 * the request does not exist or the caller may not see it — the caller decides
 * what to tell the user, so nothing about other people's requests leaks.
 */
export async function getMatchSummary(
  requestId: string
): Promise<MatchSummary | null> {
  if (!requestId) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("matching_donor_stats", {
    p_request_id: requestId,
  });

  if (error) {
    console.error("getMatchSummary failed:", error.message);
    return null;
  }

  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return null;

  return {
    isActive: Boolean(row.is_active),
    hospitalHasLocation: Boolean(row.hospital_has_location),
    totalCompatible: toNumber(row.total_compatible),
    withLocation: toNumber(row.with_location),
    within3km: toNumber(row.within_3km),
    within7km: toNumber(row.within_7km),
    within15km: toNumber(row.within_15km),
  };
}

/** Donor count inside one ring, read from the prepared summary. */
export function countWithinRadius(summary: MatchSummary, radiusKm: number): number {
  if (radiusKm <= 3) return summary.within3km;
  if (radiusKm <= 7) return summary.within7km;
  if (radiusKm <= 15) return summary.within15km;
  return summary.withLocation;
}

/**
 * The largest configured ring that still contains donors, or null when every
 * donor is beyond the outermost ring (or none has usable location). Used to
 * say honestly that donors exist but are farther away.
 */
export function largestRingWithDonors(summary: MatchSummary): number | null {
  for (let i = MATCH_RINGS_KM.length - 1; i >= 0; i--) {
    const ring = MATCH_RINGS_KM[i];
    if (countWithinRadius(summary, ring) > 0) return ring;
  }
  return null;
}

/**
 * The smallest configured ring that contains donors — i.e. the radius the
 * future alert sequence would have reached before anyone responded.
 */
export function firstRingWithDonors(summary: MatchSummary): number | null {
  for (const ring of MATCH_RINGS_KM) {
    if (countWithinRadius(summary, ring) > 0) return ring;
  }
  return null;
}

/**
 * Everything the matching view needs, with the reason an empty result is
 * empty already worked out on the server. Each variant maps to one honest
 * message in the UI — no guesswork in the browser.
 */
export type MatchResult =
  | { kind: "not-found" }
  | { kind: "inactive"; summary: MatchSummary }
  | { kind: "no-donors"; summary: MatchSummary }
  | {
      kind: "no-location";
      summary: MatchSummary;
      /** Compatible donors, sorted by nothing — there is no distance to sort by. */
      donors: MatchedDonor[];
    }
  | {
      kind: "out-of-range";
      summary: MatchSummary;
      /** Donors that exist, but beyond the outermost ring. */
      donors: MatchedDonor[];
      searchRadiusKm: number;
    }
  | {
      kind: "matches";
      summary: MatchSummary;
      donors: MatchedDonor[];
      /** Ring we expanded to in order to include the nearest donors. */
      searchRadiusKm: number;
    };

/**
 * Runs the full matching check for one request: compatible group + component,
 * available, past the application cooldown, active donor account, and
 * distance-sorted whenever the hospital area has coordinates.
 *
 * Wrapped in React's cache() so a single render can never fire the same
 * matching query twice — the page and any nested component share one result.
 */
export const getMatchResult = cache(async function getMatchResult(
  requestId: string
): Promise<MatchResult> {
  if (!requestId) return { kind: "not-found" };

  const summary = await getMatchSummary(requestId);
  if (!summary) return { kind: "not-found" };
  if (!summary.isActive) return { kind: "inactive", summary };
  if (summary.totalCompatible === 0) return { kind: "no-donors", summary };

  // No hospital coordinates: we can still match on group + component, but
  // there is no distance to sort or filter by, so nothing is hidden either.
  if (!summary.hospitalHasLocation) {
    const donors = await findMatchingDonors(requestId, { limit: 50 });
    return { kind: "no-location", summary, donors };
  }

  const ring = firstRingWithDonors(summary);

  // Donors match, but every one of them is farther than the last ring.
  if (ring === null) {
    const donors = await findMatchingDonors(requestId, { limit: 50 });
    return {
      kind: "out-of-range",
      summary,
      donors,
      searchRadiusKm: MATCH_RINGS_KM[MATCH_RINGS_KM.length - 1],
    };
  }

  const donors = await findMatchingDonors(requestId, {
    radiusKm: ring,
    limit: 50,
  });
  return { kind: "matches", summary, donors, searchRadiusKm: ring };
});

