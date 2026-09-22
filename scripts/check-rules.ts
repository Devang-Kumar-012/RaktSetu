/**
 * RaktSetu rule checks — run with: sh scripts/check-rules.sh
 *
 * Verifies the application-level rules that matching depends on:
 *   1. geo      — distance math, ~1 km coordinate rounding, invalid input
 *   2. compat   — blood-group compatibility for whole blood + platelets
 *   3. eligibility — availability / cooldown-based matching status
 *
 * These are APPLICATION rules, not medical advice. The database mirrors live
 * in supabase/migrations/0003 (cooldown) and 0005 (distance + compatibility).
 * Blood bank screening is always authoritative.
 */
import { formatDistance, haversineKm, isValidLatitude, isValidLongitude, parseCoordInput, roundCoord } from "../src/lib/geo";
import { isBloodCompatible } from "../src/lib/blood-compat";
import { getDonorEligibility } from "../src/lib/eligibility";
import { DONATION_INTERVAL_DAYS } from "../src/lib/donation-config";

let pass = 0;
const failures: string[] = [];
function check(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++;
  } else {
    failures.push(`${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

// --- 1. geo ---------------------------------------------------------------
check("roundCoord rounds to ~1 km", roundCoord(12.9715987), 12.97);
check("roundCoord negative value", roundCoord(-77.5946), -77.59);
check("haversine identical points", haversineKm(12.9716, 77.5946, 12.9716, 77.5946), 0);
const blrMys = haversineKm(12.9716, 77.5946, 12.2958, 76.6394);
check("Bengaluru→Mysuru ~127 km", blrMys !== null && Math.abs(blrMys - 127) < 6, true);
check("missing lat returns null", haversineKm(null, 77.5, 12.9, 77.5), null);
check("NaN returns null", haversineKm(NaN, 77.5, 12.9, 77.5), null);
check("out-of-range lat returns null", haversineKm(120, 77.5, 12.9, 77.5), null);
check("lat bounds", [isValidLatitude(-90), isValidLatitude(90), isValidLatitude(90.1)], [true, true, false]);
check("lng bounds", [isValidLongitude(-180), isValidLongitude(180), isValidLongitude(180.1)], [true, true, false]);
check("blank coord input = no location", parseCoordInput("  ", "lat"), { ok: true, value: null });
check("malformed coord rejected", parseCoordInput("12.3abc", "lat"), { ok: false });
check("out-of-range input rejected", parseCoordInput("999", "lng"), { ok: false });
check("distance display: unknown", formatDistance(null), "distance unknown");
check("distance display: sub-km", formatDistance(0.3), "under 1 km");
check("distance display: km", formatDistance(7.6), "about 8 km");

// --- 2. blood-group compatibility ---------------------------------------
const GROUPS = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"];
// Whole blood: O- is the universal donor, AB+ the universal recipient.
check("whole blood: O- → AB+ allowed", isBloodCompatible("O-", "AB+", "whole_blood"), true);
check("whole blood: AB+ → O- blocked", isBloodCompatible("AB+", "O-", "whole_blood"), false);
check("whole blood: A+ → A+ allowed", isBloodCompatible("A+", "A+", "whole_blood"), true);
check("whole blood: A+ → A- blocked (Rh)", isBloodCompatible("A+", "A-", "whole_blood"), false);
check("whole blood: A- → A+ allowed", isBloodCompatible("A-", "A+", "whole_blood"), true);
check("whole blood: B+ → O+ blocked (ABO)", isBloodCompatible("B+", "O+", "whole_blood"), false);
// Platelets: ABO-identical, Rh-negative donor may serve Rh-positive recipient.
check("platelets: A- → A+ allowed", isBloodCompatible("A-", "A+", "platelets"), true);
check("platelets: A+ → A- blocked", isBloodCompatible("A+", "A-", "platelets"), false);
check("platelets: O- → A+ blocked (ABO)", isBloodCompatible("O-", "A+", "platelets"), false);
check("platelets: B+ → B+ allowed", isBloodCompatible("B+", "B+", "platelets"), true);
check("unknown component is never compatible", isBloodCompatible("A+", "A+", "plasma"), false);

// Pairwise invariants across every donor × recipient combination.
let universalDonorOk = true;
let plateletsRespectAbo = true;
for (const donor of GROUPS) {
  if (!isBloodCompatible("O-", donor, "whole_blood")) universalDonorOk = false;
  for (const recipient of GROUPS) {
    // Platelets are an ABO-identical product in our rules.
    if (isBloodCompatible(donor, recipient, "platelets")) {
      if (donor.slice(0, -1) !== recipient.slice(0, -1)) plateletsRespectAbo = false;
    }
    // An Rh-positive donor must never be offered to an Rh-negative recipient.
    if (donor.endsWith("+") && recipient.endsWith("-")) {
      if (isBloodCompatible(donor, recipient, "whole_blood")) universalDonorOk = false;
      if (isBloodCompatible(donor, recipient, "platelets")) plateletsRespectAbo = false;
    }
  }
}
check("whole blood: O- works for every group", universalDonorOk, true);
check("platelets: ABO + Rh rules hold for all pairs", plateletsRespectAbo, true);

// --- 2b. TS rules must match the SQL mirror exactly (migration 0005) --------
/** Faithful transcription of public.blood_groups_compatible() in 0005. */
function sqlBloodCompatible(donor: string, recipient: string, component: string): boolean {
  if (component !== "whole_blood" && component !== "platelets") return false;
  const dAbo = donor.slice(0, -1);
  const rAbo = recipient.slice(0, -1);
  const dRh = donor.slice(-1);
  const rRh = recipient.slice(-1);
  if (component === "platelets") {
    return dAbo === rAbo && (dRh === "-" || dRh === rRh);
  }
  return (dRh === "-" || dRh === rRh) && (dAbo === "O" || rAbo === "AB" || dAbo === rAbo);
}

let compared = 0;
let mismatches = 0;
for (const donor of GROUPS) {
  for (const recipient of GROUPS) {
    for (const component of ["whole_blood", "platelets", "plasma"]) {
      compared++;
      if (isBloodCompatible(donor, recipient, component) !== sqlBloodCompatible(donor, recipient, component)) {
        mismatches++;
      }
    }
  }
}
check(`TS and SQL blood rules agree (${compared} combos)`, mismatches, 0);

// --- 3. eligibility / availability --------------------------------------
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
check(
  "available, no donation on record",
  getDonorEligibility({ availability: "available", last_donation_date: null }).status,
  "available"
);
check(
  `available, donated ${DONATION_INTERVAL_DAYS + 5} days ago`,
  getDonorEligibility({
    availability: "available",
    last_donation_date: isoDaysAgo(DONATION_INTERVAL_DAYS + 5),
  }).status,
  "available"
);
check(
  "cooldown still active → not currently eligible",
  getDonorEligibility({ availability: "available", last_donation_date: isoDaysAgo(10) }).status,
  "not_currently_eligible"
);
check(
  "self-paused → temporarily unavailable",
  getDonorEligibility({ availability: "temporarily_unavailable", last_donation_date: null }).status,
  "temporarily_unavailable"
);
check(
  "pause wins over cooldown",
  getDonorEligibility({ availability: "temporarily_unavailable", last_donation_date: isoDaysAgo(5) }).status,
  "temporarily_unavailable"
);
const cooling = getDonorEligibility({
  availability: "available",
  last_donation_date: isoDaysAgo(10),
});
check("cooldown reports a next eligible date", typeof cooling.nextEligibleDate === "string", true);
check(
  "cooldown days remaining is sane",
  cooling.daysUntilEligible > 0 && cooling.daysUntilEligible <= DONATION_INTERVAL_DAYS,
  true
);

// --- 4. matching pipeline ------------------------------------------------
// Mirrors the filters in public.match_donors_for_request() so the matching
// foundation can be verified without a live database: active request only,
// available + past-cooldown donors only, blood-group compatible, ordered by
// distance, and never exposing private fields.
interface FakeDonor {
  user_id: string;
  blood_group: string;
  locality: string;
  phone: string; // private — must never reach the result
  availability: "available" | "temporarily_unavailable";
  last_donation_date: string | null;
  lat: number | null;
  lng: number | null;
}

function matchPipeline(
  request: { status: string; blood_group: string; component: string; lat: number | null; lng: number | null },
  donors: FakeDonor[],
  limit = 50
) {
  if (request.status !== "active") return [];
  return donors
    .filter((d) => getDonorEligibility(d).status === "available")
    .filter((d) => isBloodCompatible(d.blood_group, request.blood_group, request.component))
    .map((d) => ({
      user_id: d.user_id,
      blood_group: d.blood_group,
      locality: d.locality,
      distance_km: haversineKm(request.lat, request.lng, d.lat, d.lng),
    }))
    .sort((a, b) => {
      if (a.distance_km === null && b.distance_km === null) return 0;
      if (a.distance_km === null) return 1; // unknown distance sorts last
      if (b.distance_km === null) return -1;
      return a.distance_km - b.distance_km;
    })
    .slice(0, limit);
}

const near: FakeDonor = {
  user_id: "near", blood_group: "O-", locality: "Indiranagar", phone: "+911111111111",
  availability: "available", last_donation_date: null, lat: 12.9784, lng: 77.6408,
};
const far: FakeDonor = {
  user_id: "far", blood_group: "O-", locality: "Whitefield", phone: "+912222222222",
  availability: "available", last_donation_date: null, lat: 12.9698, lng: 77.7500,
};
const paused: FakeDonor = {
  ...near, user_id: "paused", availability: "temporarily_unavailable",
};
const onCooldown: FakeDonor = {
  ...near, user_id: "cooling", last_donation_date: isoDaysAgo(5),
};
const wrongGroup: FakeDonor = {
  ...near, user_id: "wrongGroup", blood_group: "B+",
};
const noCoords: FakeDonor = {
  ...near, user_id: "noCoords", lat: null, lng: null,
};
const hospital = { lat: 12.9716, lng: 77.5946 };

const activeRequest = { status: "active", blood_group: "A+", component: "whole_blood", ...hospital };
const donors = [far, paused, onCooldown, wrongGroup, noCoords, near];

const matched = matchPipeline(activeRequest, donors);
check("pipeline excludes paused, cooling and incompatible donors", matched.map((m) => m.user_id), ["near", "far", "noCoords"]);
check(
  "pipeline: sorted by real distance (near < far)",
  matched[0].distance_km !== null &&
    matched[1].distance_km !== null &&
    matched[0].distance_km < matched[1].distance_km &&
    matched[0].distance_km > 0,
  true
);
check(
  "pipeline: donors without coordinates sort last",
  matched[matched.length - 1].user_id,
  "noCoords"
);
check("pipeline: limit is respected", matchPipeline(activeRequest, donors, 2).length, 2);
check(
  "pipeline: inactive request matches nobody",
  matchPipeline({ ...activeRequest, status: "fulfilled" }, donors),
  []
);
check(
  "pipeline: cancelled request matches nobody",
  matchPipeline({ ...activeRequest, status: "cancelled" }, donors),
  []
);
check(
  "pipeline: request without coordinates still matches (distance unknown)",
  matchPipeline({ ...activeRequest, lat: null, lng: null }, donors).map((m) => m.distance_km),
  [null, null, null]
);
check(
  "pipeline: never returns private fields",
  matched.every((m) => Object.keys(m).sort().join(",") === "blood_group,distance_km,locality,user_id"),
  true
);

// --- report --------------------------------------------------------------
if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} rule check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(`\n${pass} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`✓ all ${pass} rule checks passed`);

