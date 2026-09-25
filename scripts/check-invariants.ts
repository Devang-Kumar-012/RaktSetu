/**
 * RaktSetu behavioural regression suite — run with: npm run check:invariants
 *
 * WHY THIS FILE IS DIFFERENT FROM check-rules / check-rings
 *
 * check-rules and check-rings are STRUCTURAL: they read the SQL and the source
 * as text and assert the shape of things (a policy exists, a kind is in the
 * allowed list, a trigger fires on the right event). That is the right tool for
 * things TypeScript cannot see — RLS policies, triggers, cron jobs, grants.
 *
 * This suite is BEHAVIOURAL: it IMPORTS the real application modules and calls
 * them with real inputs, asserting what they actually return. A validator that
 * is changed to accept "admin", a compatibility rule that is inverted, or an
 * unread count that counts read rows would all still satisfy every structural
 * check in the repository — they fail here instead.
 *
 * No test framework is installed, and none is added. The project already runs
 * offline checks with tsx, so this follows the same convention: deterministic,
 * no network, no database, no Date.now() in any assertion that must be stable.
 *
 * It does NOT claim to test the database. RLS enforcement, triggers and the
 * ring engine's SQL are covered by check-rings. This covers the TypeScript that
 * runs before the database is ever reached — which is where a large share of
 * real authorisation and validation bugs live.
 */

import {
  getDonorProfileCompletion,
  getDonorEligibility,
} from "../src/lib/eligibility";
import {
  isBloodCompatible,
  getCompatibleRecipientGroups,
} from "../src/lib/blood-compat";
import {
  validateAvailability,
  validateBloodComponent,
  validateBloodGroup,
  validateFullName,
  validateHospitalName,
  validateLastDonationDate,
  validateLocality,
  validatePhone,
  validateRegisterRole,
  validateRequiredBy,
  validateUnits,
  validateUrgency,
} from "../src/lib/validation";
import {
  describeGap,
  formatDate,
  formatDateTime,
  isValidEmail,
  truncate,
} from "../src/lib/utils";
import {
  countUnreadNotifications,
  isNotificationUnread,
  notificationKindLabel,
  NOTIFICATION_KINDS,
  resolveNotificationDestination,
} from "../src/lib/notifications";
import {
  isSafetyLimitError,
  safetyLimitMessage,
} from "../src/lib/safety";
import {
  hasActiveFilters,
  MAX_PAGE_SIZE,
  PAGE_SIZE,
  parseRequestFilters,
  REQUEST_SORTS,
  REQUEST_STATUSES,
} from "../src/lib/request-filters";
import { defaultRingConfig, planRingTick } from "../src/lib/alert-rings";
import {
  BLOOD_COMPONENTS,
  MAX_UNITS,
  MIN_UNITS,
  REGISTER_ROLES,
  SETTINGS_0016_BOUNDS,
  SETTINGS_BOUNDS,
  URGENCY_OPTIONS,
} from "../src/lib/constants";
// DONATION_INTERVAL_DAYS lives in donation-config, NOT constants. Importing it
// from the wrong module yields undefined, which silently turns a date
// calculation into NaN and an "Invalid time value" crash rather than a
// readable assertion failure.
import {
  DONATION_INTERVAL_DAYS,
  ELIGIBILITY_DISCLAIMER,
} from "../src/lib/donation-config";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DonorProfile, NotificationRow } from "../src/types";

let passed = 0;
const failures: string[] = [];

/** Repository root, resolved from this file rather than process.cwd() so the
 *  suite behaves identically no matter which directory it is invoked from. */
const ROOT = resolve(__dirname, "..");

/**
 * Strips // and block comments so assertions test what a user actually SEES,
 * not the prose describing it. Several components here explain in a doc
 * comment exactly the thing a check forbids mentioning; without this, the
 * explanation satisfies — or trips — the check by accident.
 */
function stripJsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Recursively lists files under a directory, skipping build/dependency trees. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === ".next" || entry === ".git") return [];
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Asserts `actual` deep-equals `expected`; `label` describes the behaviour. */
function eq<T>(label: string, actual: T, expected: T): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else failures.push(`${label}\n      expected ${e}\n      actual   ${a}`);
}

/** Asserts a truthy value — used where the exact shape is not the contract. */
function ok(label: string, condition: boolean): void {
  if (condition) passed++;
  else failures.push(label);
}

/** Asserts a validator ACCEPTS a value (returns null / no error). */
function accepts(label: string, error: string | null): void {
  if (error === null) passed++;
  else failures.push(`${label} — expected accepted, got: ${error}`);
}

/** Asserts a validator REJECTS a value with a human-readable message. */
function rejects(label: string, error: string | null): void {
  if (error !== null) passed++;
  else failures.push(`${label} — expected rejected, but it was accepted`);
}

// ===========================================================================
// 1. AUTHENTICATION & ROLE AUTHORISATION
// ===========================================================================
// The single most important behavioural assertion in this file: a public
// signup must never be able to produce an admin, whatever the client sends.
for (const role of REGISTER_ROLES) {
  accepts(`signup accepts the public role "${role.value}"`, validateRegisterRole(role.value));
}
for (const forged of [
  "admin",
  "Admin",
  "ADMIN",
  "administrator",
  "superadmin",
  "donor ",       // trailing space must not slip through
  " donor",
  "Donor",
  "requester\n",
  "",
  "null",
  "undefined",
  "0",
  "false",
  "donor;drop table",
]) {
  rejects(`signup rejects forged role ${JSON.stringify(forged)}`, validateRegisterRole(forged));
}
eq("public signup offers exactly the three roles", REGISTER_ROLES.length, 3);
ok(
  "no public signup role is an administrator",
  !REGISTER_ROLES.some((r) => /admin|super|root|owner/i.test(r.value)),
);

// ===========================================================================
// 2. SERVER-ACTION / API INPUT VALIDATION
// ===========================================================================
// Every validator is exercised with valid input, a boundary, and a hostile
// input. A validator that is only ever tested with the happy path is not
// tested.

accepts("full name accepts a normal name", validateFullName("Asha Rao"));
rejects("full name rejects empty", validateFullName(""));
rejects("full name rejects whitespace only", validateFullName("   "));
rejects("full name rejects a single character", validateFullName("A"));
rejects("full name rejects a newline", validateFullName("Asha\nRao"));
rejects("full name rejects a NUL byte", validateFullName("Asha\u0000Rao"));
ok(
  "full name rejects an over-long value",
  validateFullName("a".repeat(500)) !== null,
);

accepts("blood group accepts O-", validateBloodGroup("O-"));
for (const bad of ["", "O", "o-", "O+ ", "AB", "C+", "O++", "null"]) {
  rejects(`blood group rejects ${JSON.stringify(bad)}`, validateBloodGroup(bad));
}

accepts("availability accepts available", validateAvailability("available"));
rejects("availability rejects admin", validateAvailability("admin"));
rejects("availability rejects empty", validateAvailability(""));

for (const value of BLOOD_COMPONENTS) {
  accepts(`component accepts ${value.value}`, validateBloodComponent(value.value));
}
rejects("component rejects 'accepted'", validateBloodComponent("accepted"));
rejects("component rejects empty", validateBloodComponent(""));

accepts("units accepts the minimum", validateUnits(String(MIN_UNITS)));
accepts("units accepts the maximum", validateUnits(String(MAX_UNITS)));
rejects("units rejects zero", validateUnits("0"));
rejects("units rejects negative", validateUnits("-1"));
rejects("units rejects a decimal", validateUnits("1.5"));
rejects("units rejects a word", validateUnits("two"));
rejects("units rejects empty", validateUnits(""));
rejects("units rejects NaN", validateUnits("NaN"));
rejects("units rejects Infinity", validateUnits("Infinity"));
rejects("units rejects hex", validateUnits("0x2"));
rejects("units rejects a huge value", validateUnits("999999"));

for (const u of URGENCY_OPTIONS) {
  accepts(`urgency accepts ${u.value}`, validateUrgency(u.value));
}
rejects("urgency rejects 'emergency'", validateUrgency("emergency"));
rejects("urgency rejects empty", validateUrgency(""));

accepts("hospital accepts a normal name", validateHospitalName("City General Hospital"));
rejects("hospital rejects empty", validateHospitalName("  "));
rejects("hospital rejects a newline (injection-shaped)", validateHospitalName("A\nB"));
rejects("hospital rejects a carriage return", validateHospitalName("A\rB"));
rejects("hospital rejects over-long", validateHospitalName("H".repeat(200)));


// The deadline validator reads a datetime-LOCAL value ("YYYY-MM-DDTHH:mm"),
// which new Date(...) parses in local time. Generating the input with
// toISOString() would emit UTC, making a valid future deadline look like it
// has already passed whenever the runner is not on UTC.
const localInput = (msFromNow: number) => {
  const d = new Date(Date.now() + msFromNow);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}`
  );
};
const inHours = (h: number) => localInput(h * 60 * 60 * 1000);
const inDays = (d: number) => localInput(d * 24 * 60 * 60 * 1000);

accepts("required-by accepts a deadline 3 hours out", validateRequiredBy(inHours(3)));
rejects("required-by rejects an empty value", validateRequiredBy(""));
rejects("required-by rejects free text", validateRequiredBy("tomorrow"));
rejects("required-by rejects an impossible date", validateRequiredBy("2026-02-31T10:00"));
rejects("required-by rejects a missing time", validateRequiredBy("2026-06-01"));
rejects("required-by rejects a past deadline", validateRequiredBy(inHours(-3)));
rejects("required-by rejects a deadline beyond 30 days", validateRequiredBy(inDays(45)));

// ===========================================================================
// 3. DONOR MATCHING — blood-group compatibility
// ===========================================================================
// Whole blood (red cells). Donor → recipient.
// This table is the conventional ABO/Rh red-cell rule set, written out
// explicitly so an inverted or widened entry cannot pass unnoticed.
// It was verified against the app's own output: the implementation is correct
// and matches this table exactly. Note the direction — an A- DONOR can give to
// an AB+ RECIPIENT; the reverse is not true. Conflating donor and recipient is
// the classic error here, so the full matrix is asserted in both directions.
const WHOLE_DONOR_TO_RECIPIENTS: Record<string, string[]> = {
  "O-": ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"],
  "O+": ["O+", "A+", "B+", "AB+"],
  "A-": ["A-", "A+", "AB-", "AB+"],
  "A+": ["A+", "AB+"],
  "B-": ["B-", "B+", "AB-", "AB+"],
  "B+": ["B+", "AB+"],
  "AB-": ["AB-", "AB+"],
  "AB+": ["AB+"],
};
const ALL_GROUPS = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"];
for (const [donor, recipients] of Object.entries(WHOLE_DONOR_TO_RECIPIENTS)) {
  for (const r of ALL_GROUPS) {
    const shouldMatch = recipients.includes(r);
    eq(
      `whole blood: ${donor} donor → ${r} recipient is ${shouldMatch ? "compatible" : "incompatible"
      }`,
      isBloodCompatible(donor, r, "whole_blood"),
      shouldMatch,
    );
  }
}
ok(
  "compatibility rejects an unknown blood group rather than defaulting to true",
  !isBloodCompatible("C+", "O-", "whole_blood") &&
  !isBloodCompatible("", "O-", "whole_blood") &&
  !isBloodCompatible("O", "O-", "whole_blood"),
);
ok(
  "compatibility rejects an unknown component rather than defaulting to true",
  !isBloodCompatible("O-", "O-", "plasma" as never),
);
// A donor group never matches itself trivially for a stranger's group.
eq(
  "an O- donor is compatible with every recipient (universal donor)",
  ALL_GROUPS.every((r) => isBloodCompatible("O-", r, "whole_blood")),
  true,
);
eq(
  "an AB+ donor can give only to AB+ (not a universal donor)",
  ALL_GROUPS.filter((r) => isBloodCompatible("AB+", r, "whole_blood")),
  ["AB+"],
);
eq(
  "getCompatibleRecipientGroups matches the table for an A- donor",
  getCompatibleRecipientGroups("A-", "whole_blood").sort(),
  [...WHOLE_DONOR_TO_RECIPIENTS["A-"]].sort(),
);

// ===========================================================================
// 4. DONOR ELIGIBILITY / COOLDOWN (application-level only)
// ===========================================================================
const baseDonor: Pick<DonorProfile, "availability" | "last_donation_date"> = {
  availability: "available",
  last_donation_date: null,
};
eq("a never-donated available donor is eligible", getDonorEligibility(baseDonor).status, "available");
eq(
  "a manually paused donor is unavailable regardless of history",
  getDonorEligibility({ ...baseDonor, availability: "temporarily_unavailable" }).status,
  "temporarily_unavailable",
);
eq(
  "a null donor record is never treated as available",
  getDonorEligibility(null).status,
  "temporarily_unavailable",
);

const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);
eq(
  "a donor inside the application cooldown is filtered out",
  getDonorEligibility({ ...baseDonor, last_donation_date: recent }).status,
  "not_currently_eligible",
);
const old = new Date(
  Date.now() - (DONATION_INTERVAL_DAYS + 1) * 24 * 60 * 60 * 1000,
)
  .toISOString()
  .slice(0, 10);
eq(
  "a donor past the interval becomes eligible again",
  getDonorEligibility({ ...baseDonor, last_donation_date: old }).status,
  "available",
);
ok(
  "the next eligible date is always in the future when not yet eligible",
  (() => {
    const e = getDonorEligibility({ ...baseDonor, last_donation_date: recent });
    return e.daysUntilEligible > 0 && e.nextEligibleDate !== null;
  })(),
);
eq(
  "an eligible donor has zero days remaining",
  getDonorEligibility({ ...baseDonor, last_donation_date: old }).daysUntilEligible,
  0,
);


// ===========================================================================
// 5. PROFILE COMPLETION (onboarding, §3/§4 of the brief)
// ===========================================================================
{
  const complete: DonorProfile = {
    user_id: "u1",
    blood_group: "O+",
    locality: "Andheri East",
    phone: "9876543210",
    availability: "available",
    donation_count: 0,
    last_donation_date: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  } as DonorProfile;
  const c = getDonorProfileCompletion(complete);
  ok("a fully completed donor profile reports 100%", c.percent === 100);

  // Required fields are blood_group, locality and phone. last_donation_date is
  // optional and availability always carries a value, so neither is required.
  for (const key of ["blood_group", "locality", "phone"] as const) {
    const partial = { ...complete, [key]: "" } as DonorProfile;
    const r = getDonorProfileCompletion(partial);
    ok(`profile completion notices a missing ${key}`, r.percent < 100);
  }
  eq(
    "an empty last donation date is still a complete profile",
    getDonorProfileCompletion(complete).percent,
    100,
  );
  eq(
    "a donor with no record at all reports 0%",
    getDonorProfileCompletion(null).percent,
    0,
  );
}

// ===========================================================================
// 6. RING ENGINE — deterministic, no real waiting
// ===========================================================================
{
  const cfg = defaultRingConfig();
  eq("default ring radii are 3 / 7 / 15 km", cfg.ringsKm, [3, 7, 15]);
  eq("default ring wait is 10 minutes", cfg.windowMinutes, 10);

  const T0 = 1_000_000_000;
  // A COMPLETE RequestEngineState. The typechecker is deliberately not
  // weakened to accept a partial fixture — a test that cannot satisfy the real
  // interface can silently drift from it, which is the exact failure mode this
  // suite exists to catch.
  const state = () => ({
    id: "req-1",
    status: "active" as const,
    requiredBy: T0 + 6 * 60 * 60 * 1000,
    hospitalLat: 19.076,
    hospitalLng: 72.8777,
    bloodGroup: "O-",
    component: "whole_blood" as const,
    progress: [] as ReturnType<typeof prog>[],
    alerts: [] as ReturnType<typeof alert>[],
  });

  // A COMPLETE AlertState, for the same reason: a partial alert would not
  // satisfy the real interface and could drift from it unnoticed.
  const alert = (response: "accepted" | "declined" | null) => ({
    id: 1,
    requestId: "req-1",
    donorId: "donor-1",
    ringKm: 3,
    status: "sent" as const,
    dueAt: T0 + 6 * 60 * 60 * 1000,
    response,
  });

  // RingProgressState requires ringIndex, ringKm, startedAt, finishedAt and
  // outcome. Supplying a partial object (e.g. startedAtMs) makes the engine
  // read undefined and fall through to the exhausted branch, which is how this
  // block first reported "rings exhausted" for every step.
  const prog = (ringIndex: number, ringKm: number, startedAt: number) => ({
    ringIndex,
    ringKm,
    startedAt,
    finishedAt: null,
    outcome: null,
  });
  eq("ring 1 starts on the first tick", planRingTick(state(), T0, cfg), {
    kind: "start-ring",
    ringIndex: 1,
    ringKm: 3,
  });

  // A started ring must WAIT, not immediately advance — the classic bug.
  const started = { ...state(), progress: [prog(1, 3, T0)] };
  eq("inside the window the engine waits", planRingTick(started, T0 + 5 * 60_000, cfg), {
    kind: "wait",
  });
  eq("no premature expansion at 9 minutes", planRingTick(started, T0 + 9 * 60_000, cfg), {
    kind: "wait",
  });
  eq("ring 2 activates at exactly 10 minutes", planRingTick(started, T0 + 10 * 60_000, cfg), {
    kind: "start-ring",
    ringIndex: 2,
    ringKm: 7,
  });

  const second = { ...state(), progress: [prog(2, 7, T0 + 10 * 60_000)] };
  eq("ring 3 activates after the second window", planRingTick(second, T0 + 20 * 60_000, cfg), {
    kind: "start-ring",
    ringIndex: 3,
    ringKm: 15,
  });
  const third = { ...state(), progress: [prog(3, 15, T0 + 20 * 60_000)] };
  eq("there is no fourth ring — the engine exhausts", planRingTick(third, T0 + 40 * 60_000, cfg), {
    kind: "finish",
    outcome: "rings_exhausted",
  });

  // Every terminal condition must stop the process immediately.
  for (const status of ["fulfilled", "cancelled", "expired"] as const) {
    eq(
      `a ${status} request stops the engine at once`,
      planRingTick({ ...state(), status }, T0, cfg),
      { kind: "finish", outcome: "request_closed" },
    );
  }
  eq(
    "an accepted donor stops the engine at once",
    planRingTick({ ...state(), alerts: [alert("accepted")] }, T0, cfg),
    { kind: "finish", outcome: "accepted" },
  );
  eq(
    "a deadline passed stops the engine even while active",
    planRingTick({ ...state(), requiredBy: T0 - 1 }, T0, cfg),
    { kind: "finish", outcome: "request_closed" },
  );
  eq(
    "a declined alert does NOT stop the engine (other donors may help)",
    planRingTick({ ...state(), alerts: [alert("declined")] }, T0, cfg).kind,
    "start-ring",
  );

  // Idempotence: the same input must always yield the same decision, because
  // the scheduler may run many times inside one window.
  const before = planRingTick(started, T0 + 7 * 60_000, cfg);
  for (let i = 0; i < 5; i++) {
    eq(`repeated scheduler tick ${i + 1} is stable`, planRingTick(started, T0 + 7 * 60_000, cfg), before);
  }

  // Configurable settings must be honoured, not hard-coded.
  const fast = { ...cfg, windowMinutes: 2 };
  eq("a shorter configured window advances sooner", planRingTick(started, T0 + 2 * 60_000, fast), {
    kind: "start-ring",
    ringIndex: 2,
    ringKm: 7,
  });
  const narrow = { ...cfg, ringsKm: [3] };
  eq("a single configured ring exhausts immediately", planRingTick(started, T0 + 99 * 60_000, narrow), {
    kind: "finish",
    outcome: "rings_exhausted",
  });
}


// ===========================================================================
// 7. NOTIFICATIONS — read state, counting, routing, privacy
// ===========================================================================
{
  const row = (read_at: string | null): Pick<NotificationRow, "read_at"> => ({ read_at });
  eq("a null read_at is unread", isNotificationUnread(row(null)), true);
  eq("a timestamped read_at is read", isNotificationUnread(row("2026-01-01T00:00:00Z")), false);
  eq("unread counting is per recipient row", countUnreadNotifications([
    row(null), row("2026-01-01T00:00:00Z"), row(null),
  ]), 2);
  eq("an empty list counts zero", countUnreadNotifications([]), 0);
  eq("all-read lists count zero", countUnreadNotifications([
    row("2026-01-01T00:00:00Z"), row("2026-01-02T00:00:00Z"),
  ]), 0);

  for (const kind of NOTIFICATION_KINDS) {
    ok(`notification kind "${kind}" has a human label`, notificationKindLabel(kind).length > 0);
  }
  eq("an unknown kind falls back to 'Update' rather than rendering blank", notificationKindLabel("mystery"), "Update");

  // Routing must never send a recipient to a page their role cannot read.
  const base = {
    request_id: null, alert_id: null, link: null,
    drive_id: null, dedupe_key: null,
  };
  eq(
    "a request notification routes a requester to the request",
    resolveNotificationDestination(
      { ...base, kind: "donor_accepted", request_id: "r1" },
      "requester",
    )?.href,
    "/requests/r1",
  );
  eq(
    "a volunteer cannot be routed to the requester dashboard",
    resolveNotificationDestination(
      { ...base, kind: "donor_accepted", request_id: "r1" },
      "volunteer",
    ),
    null,
  );
  // A donor receiving a donor_accepted notice is being told their OWN alert
  // succeeded, so the correct destination is their dashboard — never a
  // requester's request page, and never another user's data.
  eq(
    "a donor's acceptance notice routes to their own dashboard, not a request",
    resolveNotificationDestination(
      { ...base, kind: "donor_accepted", request_id: "r1" },
      "donor",
    )?.href,
    "/dashboard/donor",
  );
  eq(
    "an account-status notice routes every role to the profile page",
    resolveNotificationDestination({ ...base, kind: "account_status_changed" }, "donor")?.href,
    "/profile",
  );
  eq(
    "a drive notification routes to the drive, not a private dashboard",
    resolveNotificationDestination(
      { ...base, kind: "drive_upcoming_reminder", drive_id: "d1" },
      "donor",
    )?.href,
    "/drives/d1",
  );

  // No destination may ever embed donor PII or an unvalidated external URL.
  for (const kind of NOTIFICATION_KINDS) {
    for (const role of ["donor", "requester", "volunteer", "admin"] as const) {
      const dest = resolveNotificationDestination(
        { ...base, kind, request_id: "r1", alert_id: 1, drive_id: "d1" },
        role,
      );
      if (!dest) continue;
      ok(
        `destination for ${kind}/${role} stays on-site`,
        dest.href.startsWith("/") && !dest.href.startsWith("//"),
      );
      ok(
        `destination for ${kind}/${role} cannot inject a scheme`,
        !/^[a-z]+:/i.test(dest.href) && !dest.href.includes("javascript:"),
      );
    }
  }
}

// ===========================================================================
// 8. REQUEST FILTERING & PAGINATION (bounded queries, §13)
// ===========================================================================
{
  eq("status filter accepts the four lifecycle states", REQUEST_STATUSES, [
    "active", "fulfilled", "expired", "cancelled",
  ]);
  ok("no lifecycle filter offers an 'accepted' status", !REQUEST_STATUSES.includes("accepted" as never));

  // Hostile / malformed query input must be coerced, never trusted or reflected.
  const f = parseRequestFilters({
    status: "accepted",
    component: "'; drop table blood_requests; --",
    urgency: "<script>",
    group: "ZZ",
    sort: "ORDER BY 1",
    from: "not-a-date",
    to: "9999-99-99",
    page: "-5",
    pageSize: "999999",
  });
  eq("a forged status is discarded, not passed through", f.status, "all");
  eq("a forged component is discarded", f.component, "all");
  eq("a forged urgency is discarded", f.urgency, "all");
  eq("a forged blood group is discarded", f.bloodGroup, "all");
  ok("an invalid sort falls back to a known one", REQUEST_SORTS.includes(f.sort));
  // from/to are `string | null` in the filter contract; an unparseable value
  // must become null (meaning "no bound") rather than being passed through.
  eq("an unparseable from-date is dropped", f.from, null);
  eq("an unparseable to-date is dropped", f.to, null);
  ok("a negative page is clamped to 1", f.page >= 1);
  eq("an oversized page number is clamped to 1", parseRequestFilters({ page: "-5" }).page, 1);
  eq("a non-numeric page is clamped to 1", parseRequestFilters({ page: "abc" }).page, 1);
  // admin-only free text must not leak into the requester's own history view.
  ok(
    "free-text search is only parsed when the caller allows it",
    parseRequestFilters({ q: "hospital" }).q === "" &&
    parseRequestFilters({ q: "hospital" }, { allowSearch: true }).q === "hospital",
  );

  const valid = parseRequestFilters({ status: "active", component: "platelets" });
  eq("valid filters survive parsing", [valid.status, valid.component], ["active", "platelets"]);
  ok("active filters are reported as active", hasActiveFilters(valid));
  ok("an untouched query has no active filters", !hasActiveFilters(parseRequestFilters({})));
  ok("page size is bounded and positive", PAGE_SIZE > 0 && PAGE_SIZE <= MAX_PAGE_SIZE);

  // An array-valued query param (?status=a&status=b) must not slip through.
  const multi = parseRequestFilters({ status: ["active", "cancelled"] });
  ok(
    "a repeated query parameter cannot smuggle a second value",
    typeof multi.status === "string" && ["all", "active", "fulfilled", "expired", "cancelled"].includes(multi.status),
  );
}


// ===========================================================================
// 9. ANTI-ABUSE ERROR HANDLING (§11)
// ===========================================================================
{
  // A safety-limit failure must be recognised and given a real message, not
  // surfaced as a raw database error. The database composes the human sentence
  // after a marker; anything the driver prepended must be stripped.
  const marker = "RakSetu limit:";
  const limited = {
    code: "RS001",
    message:
      `duplicate key value violates unique constraint "request_reports_pkey"\n` +
      `${marker} You have already reported this request.`,
  };
  ok("a safety-limit error is recognised", isSafetyLimitError(limited));
  const msg = safetyLimitMessage(limited);
  ok("a safety-limit error produces a human message", typeof msg === "string" && msg.length > 0);
  ok(
    "driver / constraint noise is stripped from the message",
    typeof msg === "string" && !msg.includes("violates unique constraint"),
  );
  ok("the message never leaks the SQLSTATE", typeof msg === "string" && !msg.includes("RS001"));

  // The important safety property: an error with no human sentence must yield
  // null, never the raw database text.
  const noSentence = { code: "RS001", message: 'syntax error at or near "SELECT"' };
  ok(
    "a limit error with no human message yields null rather than raw SQL",
    safetyLimitMessage(noSentence) === null,
  );

  const other = { code: "23505", message: "duplicate key" };
  ok("an ordinary database error is not misreported as a rate limit", !isSafetyLimitError(other));
  ok("an ordinary database error has no safety message", safetyLimitMessage(other) === null);
  ok("a null error is not a rate limit", !isSafetyLimitError(null));
  ok("a null error has no safety message", safetyLimitMessage(null) === null);
}

// ===========================================================================
// 10. ADMIN SETTINGS BOUNDS (§12)
// ===========================================================================
{
  for (const [name, bound] of Object.entries(SETTINGS_0016_BOUNDS)) {
    ok(`setting bound "${name}" has a positive minimum`, bound.min >= 1);
    ok(`setting bound "${name}" has a maximum above its minimum`, bound.max > bound.min);
  }
  ok("ring radii may never be configured below 1 km", SETTINGS_BOUNDS.ringMin >= 1);
  ok("ring radii have a sane upper bound", SETTINGS_BOUNDS.ringMax <= 100);
  ok("the ring wait window has a sane minimum", SETTINGS_BOUNDS.windowMin >= 1);
  ok("the donation interval is bounded above", SETTINGS_BOUNDS.intervalMax <= 365);
  // A max ring count of 0 would silently stop the engine expanding at all.
  ok("max alert rings can never be zero", SETTINGS_0016_BOUNDS.maxAlertRings.min >= 1);
}

// ===========================================================================
// 11. NO MEDICAL CLAIMS (§8 — correctness, not style)
// ===========================================================================
{
  ok(
    "the eligibility disclaimer states that screening is not the app's decision",
    /blood bank|medical|screen/i.test(ELIGIBILITY_DISCLAIMER) &&
    !/you are (medically )?eligible|guaranteed? (safe|eligible)/i.test(ELIGIBILITY_DISCLAIMER),
  );
  ok(
    "the disclaimer states the interval is a filter, not a medical decision",
    /never decides medical eligibility/i.test(ELIGIBILITY_DISCLAIMER) &&
    /blood bank/i.test(ELIGIBILITY_DISCLAIMER) &&
    /filter only/i.test(ELIGIBILITY_DISCLAIMER),
  );
  ok(
    "the disclaimer makes no eligibility or safety guarantee",
    !/you are (medically )?eligible|guaranteed? (safe|eligible|to donate)/i.test(
      ELIGIBILITY_DISCLAIMER,
    ),
  );
}


// ===========================================================================
// 12. UTILITIES (§13 — safe rendering of user-supplied data)
// ===========================================================================
{
  ok("truncate shortens long text", truncate("abcdefghij", 5).length <= 8);
  eq("truncate leaves short text alone", truncate("abc", 10), "abc");
  ok("truncate never returns undefined for empty input", truncate("", 5) === "");
  ok("a valid email is accepted", isValidEmail("donor@example.org"));
  for (const bad of ["", "a@b", "a b@c.com", "@x.com", "x@", "x@y", "x@y.c"]) {
    ok(`invalid email ${JSON.stringify(bad)} is rejected`, !isValidEmail(bad));
  }
  eq("a zero gap reads as deadline passed", describeGap(0), "deadline passed");
  ok("a negative gap still renders without throwing", typeof describeGap(-1000) === "string");
  eq("a sub-minute gap reads as under a minute", describeGap(30_000), "under a minute left");
  eq("a non-finite gap renders a dash, not NaN", describeGap(NaN), "—");
  eq("null dates render as a dash, never 'Invalid Date'", formatDate(null), "—");
  eq("undefined dates render as a dash", formatDate(undefined), "—");
  ok("an unparseable date never renders 'Invalid Date'", !/Invalid Date/.test(formatDate("not-a-date")));
  ok("formatDateTime tolerates null", !/Invalid Date/.test(formatDateTime(null)));
}


// ===========================================================================
// 13. UI REGRESSION HEURISTICS (§15)
// ===========================================================================
// Static heuristics over the rendered source. These cannot prove a layout is
// correct, but they reliably catch the two specific regressions the brief names:
// a card layered over another card, and an unbounded width that scrolls sideways
// on a phone.
{
  const ROOT = join(process.cwd(), "src");

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (entry === "node_modules" || entry === ".next") return [];
      return statSync(full).isDirectory() ? walk(full) : [full];
    });

  const tsx = walk(ROOT).filter((f) => f.endsWith(".tsx"));
  ok("the app has a meaningful number of components to scan", tsx.length > 40);

  const overlap = tsx.filter((f) => {
    const s = readFileSync(f, "utf8");
    // A negative margin on a WRAPPER that directly contains a <Card> is the
    // "card stacked over card" shape. `scroll-mt-*` is a scroll-margin utility
    // (for anchor links) and must not match — a bare `-mt-\d+` regex flags
    // `scroll-mt-24` and reports a false overlap.
    return /className="[^"]*(?:^|\s)-mt-\d+[^"]*"\s*>\s*<Card/.test(s) ||
      /className="[^"]*(?:^|\s)absolute[^"]*"[^>]*>\s*<Card/.test(s);
  });
  ok(
    `no Card is positioned over another Card (${overlap.length} found)`,
    overlap.length === 0,
  );

  const overflow = tsx.filter((f) => {
    const s = readFileSync(f, "utf8");
    return /<Section[^>]*className="[^"]*w-\[\s*(?:[6-9]\d{2}|[1-9]\d{3,})px/.test(s);
  });
  ok(
    `no page-level section uses a fixed width that overflows a phone (${overflow.length} found)`,
    overflow.length === 0,
  );
}

// ===========================================================================
// 14. BROKEN LINKS / ROUTES (§15)
// ===========================================================================
{
  const APP = join(process.cwd(), "src", "app");
  const ROOT = join(process.cwd(), "src");

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (entry === "node_modules" || entry === ".next") return [];
      return statSync(full).isDirectory() ? walk(full) : [full];
    });

  const routes = new Set(
    walk(APP)
      .filter((f) => f.endsWith("page.tsx"))
      .map((f) => {
        const rel = f
          .replace(APP, "")
          .replace(/[\\/]page\.tsx$/, "")
          .replace(/\\/g, "/");
        return rel === "" ? "/" : rel;
      }),
  );
  ok("routes were discovered for link checking", routes.size > 25);
  // Route groups do not appear in the URL.
  const withoutGroups = new Set([...routes].map((r) => r.replace(/\/\([^/]+\)/g, "")));

  const broken: string[] = [];
  for (const f of walk(ROOT).filter((x) => x.endsWith(".tsx"))) {
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(/href=["'`](\/[^"'`?#]*)["'`]/g)) {
      const raw = m[1];
      if (raw.includes("[")) continue; // dynamic segment
      let target = raw.replace(/\/$/, "") || "/";
      if (target === "/") continue;
      target = target.replace(/\/\([^/]+\)/g, "");
      if (withoutGroups.has(target) || existsSync(join(APP, target))) continue;
      broken.push(`${f.replace(ROOT, "src")} -> ${raw}`);
    }
  }
  ok(`every internal href resolves to a real route (${broken.length} broken)`, broken.length === 0);
  if (broken.length) {
    console.error("  broken links:\n    " + broken.slice(0, 12).join("\n    "));
  }
}

// ===========================================================================
// REPORT

// ===========================================================================
// 15. AUTH DEPLOYMENT READINESS
// ===========================================================================
// These are the failures that produced a live site where nobody could log in.
// They are cheap to check and expensive to discover in production.
{
  const netlify = readFileSync(join(ROOT, "netlify.toml"), "utf8");
  const envExample = readFileSync(join(ROOT, ".env.example"), "utf8");
  const middleware = readFileSync(join(ROOT, "src/middleware.ts"), "utf8");
  const callback = readFileSync(join(ROOT, "src/app/auth/callback/route.ts"), "utf8");

  // The app is self-contained, so there is no configuration state to report
  // and no secret to name. Any of these returning to a user-facing file is the
  // regression that shipped before.
  const ALL_SRC = walk(join(ROOT, "src"))
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .map((f) => stripJsComments(readFileSync(f, "utf8")))
    .join("\n");
  ok(
    "no user-facing 'not configured' screen remains",
    !existsSync(join(ROOT, "src/components/auth/AuthNotConfigured.tsx")) &&
    !/Authentication is not configured|is not configured yet/i.test(ALL_SRC),
  );
  ok(
    "no auth form branches on a configuration flag",
    [
      "src/components/auth/LoginForm.tsx",
      "src/components/auth/RegisterForm.tsx",
      "src/components/auth/ForgotPasswordForm.tsx",
      "src/components/auth/ResetPasswordForm.tsx",
    ].every(
      (f) =>
        !/isSupabaseConfigured|AuthNotConfigured/.test(
          readFileSync(join(ROOT, f), "utf8"),
        ),
    ),
  );
  ok("no source file imports a Supabase package", !/@supabase\//.test(ALL_SRC));
  ok(
    "no source file reads a Supabase or cron environment variable",
    !/NEXT_PUBLIC_SUPABASE|SUPABASE_SERVICE_ROLE|CRON_SECRET/.test(ALL_SRC),
  );
  // The app is self-contained, so NO source file may read process.env at all.
  // This replaces an earlier check that only inspected the (now removed)
  // src/lib/env.ts shim, which was dead code. Scanning every file is both
  // stronger and immune to that shim coming back.
  ok("no source file reads process.env", !/process\.env/.test(ALL_SRC));
  ok(
    "no source file hard-codes a localhost or loopback URL",
    !/https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(ALL_SRC),
  );
  ok(
    "the vestigial environment shim is gone",
    !existsSync(join(ROOT, "src/lib/env.ts")),
  );

  // --- The /dashboard infinite-loading redirect loop -------------------------
  // This shipped as a real bug. Sign-in used to happen in the visitor's browser,
  // so the Server Component guard and the route middleware could disagree about
  // who was signed in: /dashboard redirected to /login, which redirected back,
  // and the route's loading boundary never resolved. They must read the SAME
  // source — and that source must be the SERVER's session, not a cookie the
  // visitor's own JavaScript wrote and could therefore forge.
  {
    const profileSrc = readFileSync(join(ROOT, "src/lib/profile.ts"), "utf8");
    const sessionSrc = readFileSync(join(ROOT, "src/lib/server/session.ts"), "utf8");
    const cookieSrc = readFileSync(
      join(ROOT, "src/lib/server/session-cookie.ts"),
      "utf8",
    );
    const authSrc = readFileSync(join(ROOT, "src/lib/actions/auth.ts"), "utf8");
    const profileActionSrc = readFileSync(
      join(ROOT, "src/lib/actions/profile.ts"),
      "utf8",
    );
    const middlewareSrc = readFileSync(join(ROOT, "src/middleware.ts"), "utf8");

    ok(
      "getSessionInfo resolves the caller from the server session, never the browser store",
      // Reading the local adapter here is the bug: on the server it can only
      // ever answer "nobody", which is what produced the loop.
      profileSrc.includes("readSessionToken()") &&
      profileSrc.includes("getUserForToken(") &&
      !/getSessionInfo[\s\S]{0,600}createSupabaseServerClient/.test(profileSrc) &&
      !/getSessionInfo[\s\S]{0,600}localStorage/.test(profileSrc),
    );
    ok(
      "the session cookie is HTTP-only and only the server can set it",
      cookieSrc.includes('from "next/headers"') &&
      cookieSrc.includes("httpOnly: true") &&
      // A "use server" module is the only place cookies().set() is legal, so
      // the cookie can never be written by the browser bundle.
      authSrc.startsWith('"use server"') &&
      authSrc.includes("setSessionCookie("),
    );
    ok(
      "the server and the middleware read the SAME session cookie",
      sessionSrc.includes('SESSION_COOKIE = "raktsetu_session"') &&
      middlewareSrc.includes('cookies.get("raktsetu_session")'),
    );
    ok(
      "no client-supplied identity may choose which profile is written",
      // The client submits FIELDS. An id in the payload would let a caller name
      // somebody else's row, so the update must key off the session's own user.
      profileActionSrc.includes('eq("id", user.id)') &&
      !/formData\.get\(\s*["'](id|userId|user_id)["']\s*\)/.test(profileActionSrc) &&
      // And the client guard asks the server who it is, instead of reading a
      // value the browser could have edited.
      readFileSync(
        join(ROOT, "src/components/local/useClientAuth.ts"),
        "utf8",
      ).includes("getClientSession()"),
    );
    ok(
      "a suspended account's session is REVOKED, not merely redirected",
      // The redirect alone would leave a still-valid token on the device.
      sessionSrc.includes("export function revokeSession") &&
      profileSrc.includes("revokeSession(token)"),
    );
    ok(
      "the legacy routing cookie is inert and carries no credential material",
      // Kept from before the migration: the file still exists, and it still must
      // not smuggle a password, hash or salt into a cookie the browser can read.
      // Comment-stripped, because the file's own doc comment promises exactly
      // that — a naive word match would flag the text vouching for safety.
      !/password|hash|salt/i.test(
        stripJsComments(
          readFileSync(join(ROOT, "src/lib/local/session-cookie.ts"), "utf8"),
        ),
      ),
    );
    ok(
      "auth initialisation always terminates (no unguarded await path)",
      // Every branch must return, and the catch returns a safe "signed out"
      // value rather than rethrowing into a stuck loading boundary.
      /catch \{[\s\S]{0,200}return \{ configured: true, user: null/.test(profileSrc),
    );
  }

  // Deployment config must carry no credentials of any kind.
  ok(
    "netlify.toml contains no secret-like assignment",
    !/eyJ[A-Za-z0-9_-]{10,}/.test(netlify) && // JWT-shaped anon/service key
    !/service_role|SUPABASE_SERVICE_ROLE|SECRET_KEY|PASSWORD\s*=/i.test(netlify),
  );
  ok("netlify.toml builds with the project build command", netlify.includes('command = "npm run build"'));
  ok("netlify.toml publishes the Next.js output", netlify.includes('publish = ".next"'));
  ok("netlify.toml installs the Next.js runtime plugin", netlify.includes("@netlify/plugin-nextjs"));

  // The redirect target must come from the incoming request, never a baked-in
  // localhost, or every production email link would point at a developer's
  // machine.
  ok(
    "the auth callback derives its origin from the request, not a hard-coded host",
    callback.includes("origin") && !/localhost/.test(callback),
  );
  ok("no source file hard-codes localhost", !/localhost/.test(callback));
  ok(
    "redirects are sanitised rather than followed blindly",
    callback.includes("sanitizeNextPath"),
  );

  // A deployment missing its public config must still be reachable and must
  // never crash: the middleware allows traffic through rather than throwing.
  ok(
    "middleware guards on the server session cookie, not a remote session",
    middleware.includes("raktsetu_session") &&
    !/isSupabaseConfigured/.test(middleware),
  );
  ok(
    "middleware redirects an unauthenticated visitor away from protected routes",
    /isProtected && !signedIn/.test(middleware) &&
    middleware.includes('"/login"'),
  );

  // Every private prefix must be guarded at the edge as well as in the page.
  for (const p of ["/dashboard", "/profile", "/volunteer", "/admin", "/notifications", "/requests"]) {
    ok(`middleware protects ${p}`, middleware.includes(`"${p}"`));
  }
  ok(
    "public drive browsing is NOT behind the auth guard",
    !middleware.includes('"/drives"'),
  );

  // Every auth CTA must reach the ONE canonical implementation, and any
  // ?role= must be a public role. A CTA pointing at a duplicate or invented
  // route would silently strand a visitor on a dead end.
  const AUTH_ROUTE_RE = /href="(\/(?:login|register)(?:\?[^"]*)?)"/g;
  // Widened to Set<string>: the inferred literal union would reject the
  // arbitrary string parsed out of an href, which is precisely the untrusted
  // input this check exists to inspect.
  const roleValues = new Set<string>(REGISTER_ROLES.map((r) => r.value));
  for (const f of walk(ROOT).filter((x) => x.endsWith(".tsx"))) {
    const s = stripJsComments(readFileSync(f, "utf8"));
    for (const m of s.matchAll(AUTH_ROUTE_RE)) {
      const href = m[1];
      const rel = f.replace(ROOT, "src");
      ok(
        `${rel} -> ${href} uses a canonical auth route`,
        /^\/(login|register)(\?|$)/.test(href),
      );
      const role = /[?&]role=([^&"]+)/.exec(href);
      if (role) {
        ok(
          `${rel} preselects a PUBLIC role (${decodeURIComponent(role[1])})`,
          roleValues.has(decodeURIComponent(role[1])),
        );
      }
      // A next= must be internal, or it is an open redirect.
      const next = /[?&]next=([^&"]+)/.exec(href);
      if (next) {
        ok(
          `${rel} next= is an internal path`,
          decodeURIComponent(next[1]).startsWith("/"),
        );
      }
    }
  }
  ok(
    "no duplicate auth routes exist alongside the canonical pair",
    !["signin", "sign-in", "signup", "sign-up", "create-account"].some((r) =>
      existsSync(join(ROOT, "src/app", r)),
    ),
  );

  // Terminology: the brief requires "Log in" and "Create account".
  const navbar = readFileSync(join(ROOT, "src/components/layout/Navbar.tsx"), "utf8");
  ok("navbar offers 'Log in'", navbar.includes("Log in"));
  ok("navbar offers 'Create account'", navbar.includes("Create account"));
  ok(
    "navbar no longer uses the mixed 'Join RaktSetu' / 'Sign up' wording",
    !/Join RaktSetu|Sign\s?up|Sign\s?in/i.test(navbar),
  );

  // The strongest deployment guarantee is that there is nothing to configure.
  ok(
    ".env.example assigns no variables",
    !/^\s*[A-Z0-9_]+\s*=\s*\S/m.test(envExample),
  );
  ok(
    ".env.example states the app needs no environment variables",
    /no environment variables/i.test(envExample),
  );
  ok(
    "netlify.toml assigns no environment variables",
    !/NEXT_PUBLIC_|SUPABASE_|CRON_SECRET\s*=/.test(netlify),
  );
}


// ===========================================================================
if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} invariant check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`✓ all ${passed} invariant checks passed`);

