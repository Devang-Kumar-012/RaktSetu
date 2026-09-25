/**
 * RaktSetu emergency ring-engine checks — run with: npm run check:rings
 *
 * Verifies the alert-ring engine (3 km → 7 km → 15 km, 10-minute windows,
 * atomic acceptance) OFFLINE with an injected fake clock — no database,
 * no network, no Date.now():
 *   1  ring 1 starts immediately from configuration
 *   2  10-minute window boundaries advance to the next ring
 *   3  rings exhaust after the final window and stay stopped
 *   4  a closed or deadlined request stops the process at once
 *   5  an accepted donor stops expansion at once
 *   6  repeat ticks are idempotent (same decision, no double-send SQL)
 *   7  ring selection: already-alerted, eligibility, compatibility, distance
 *      within the ring, closest-first, no-location fallback
 *   8  due_at = configured offset before the deadline, clamped
 *   9  acceptance resolution: outcome codes in mark_alert_responded()'s exact
 *      order; first valid acceptance wins; re-eligibility at response time
 *   10 privacy: failure and decline never open a contact window; SQL gates
 *   11 SQL↔TS invariants: constants vs SQL defaults, outcome-code parity,
 *      no 'accepted' request status, /notifications in the smoke suite
 *   12 donor-experience security regression (migration 0012): emitters are
 *      SECURITY DEFINER and revoked from clients, own-row donor gates, only
 *      an approximate distance leaves the database (never coordinates), the
 *      new notification kinds are guarded/idempotent, availability stays
 *      server-validated, and the request lifecycle is untouched
 *   13 notification-centre consistency (migration 0013): TS↔SQL parity for
 *      every notification kind, database-level duplicate prevention on a
 *      stable event key, per-recipient read state with DB-backed unread
 *      counts, role-safe routing to existing pages only, privacy of
 *      notification text, conservative read-only retention, and the
 *      mobile-safe shared rendering of the centre
 *   14 request search/filter/history (prompt 24): requester history and admin
 *      oversight share one filter/table/pager model with database-side
 *      filtering, sorting, and pagination; requester rows stay own-row gated,
 *      admin stays role-gated, closed requests stay read-only, and no new
 *      database/search service is introduced
 *   15 platform safety (prompt 25): request reporting reaches real moderation
 *      (the 0010 UPDATE grant defect that made every review fail), reporting
 *      never touches the request lifecycle, duplicate reports are stopped by a
 *      database constraint, and the anti-abuse limits live in one configurable
 *      row enforced in the database rather than as UI-only checks
 *
 * The DATABASE is the production executor (expand_alert_rings() +
 * mark_alert_responded()); src/lib/alert-rings.ts mirrors its decision rules
 * — the same TS-mirrors-SQL pattern check-rules.ts uses for compatibility.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  computeAlertDueAt,
  defaultRingConfig,
  isAlertActionable,
  planRingTick,
  resolveAcceptance,
  selectRingDonors,
} from "../src/lib/alert-rings";
import type {
  AcceptanceResult,
  AlertState,
  EligibilityDonor,
  RequestEngineState,
  RingCandidate,
  RingProgressState,
  RingRequestShape,
} from "../src/lib/alert-rings";
import {
  ALERT_DUE_AT_OFFSET_MINUTES,
  ALERT_EXPIRING_NOTICE_MINUTES,
  ALERT_RINGS_KM,
  ALERT_RING_LABELS,
  ALERT_WINDOW_MINUTES,
  REQUEST_STATUS_LABELS,
} from "../src/lib/constants";
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_LABELS,
  countUnreadNotifications,
  notificationKindLabel,
  resolveNotificationDestination,
} from "../src/lib/notifications";
import type { NotificationLike } from "../src/lib/notifications";

let pass = 0;
const failures: string[] = [];
function check(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++;
  } else {
    failures.push(
      `${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
    );
  }
}

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const sql0011 = readFileSync(
  join(ROOT, "supabase/migrations/0011_emergency_alert_rings.sql"),
  "utf8"
);
const sql0008 = readFileSync(
  join(ROOT, "supabase/migrations/0008_alerts.sql"),
  "utf8"
);
const sql0012 = readFileSync(
  join(ROOT, "supabase/migrations/0012_donor_experience.sql"),
  "utf8"
);
const srcAlerts = readFileSync(join(ROOT, "src/lib/actions/alerts.ts"), "utf8");
const srcDonorAction = readFileSync(
  join(ROOT, "src/lib/actions/donor.ts"),
  "utf8"
);
const srcDonorCard = readFileSync(
  join(ROOT, "src/components/alerts/DonorAlertCard.tsx"),
  "utf8"
);
const srcDonorControl = readFileSync(
  join(ROOT, "src/components/donor/AvailabilityControl.tsx"),
  "utf8"
);
const srcTypes = readFileSync(join(ROOT, "src/types/index.ts"), "utf8");
const srcEngine = readFileSync(join(ROOT, "src/lib/alert-rings.ts"), "utf8");
const smoke = readFileSync(join(ROOT, "scripts/smoke-test.sh"), "utf8");
// --- notification centre (migration 0013) ---------------------------------
const sql0013 = readFileSync(
  join(ROOT, "supabase/migrations/0013_notification_consistency.sql"),
  "utf8"
);
const srcNotifServer = readFileSync(
  join(ROOT, "src/lib/notifications-server.ts"),
  "utf8"
);
const srcNotifActions = readFileSync(
  join(ROOT, "src/lib/actions/notifications.ts"),
  "utf8"
);
const srcNotifLive = readFileSync(
  join(ROOT, "src/components/notifications/NotificationsLive.tsx"),
  "utf8"
);
const srcNotifItem = readFileSync(
  join(ROOT, "src/components/notifications/NotificationItem.tsx"),
  "utf8"
);
const srcNotifPage = readFileSync(
  join(ROOT, "src/app/notifications/page.tsx"),
  "utf8"
);
const srcLayout = readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8");
const srcNavbar = readFileSync(
  join(ROOT, "src/components/layout/Navbar.tsx"),
  "utf8"
);
// --- request search/filter/history (prompt 24) ---------------------------------
const srcRequestFilters = readFileSync(
  join(ROOT, "src/lib/request-filters.ts"),
  "utf8"
);
const srcFilterBar = readFileSync(
  join(ROOT, "src/components/requests/RequestFilters.tsx"),
  "utf8"
);
const srcRequestTable = readFileSync(
  join(ROOT, "src/components/requests/RequestTable.tsx"),
  "utf8"
);
const srcRequestPager = readFileSync(
  join(ROOT, "src/components/requests/RequestPager.tsx"),
  "utf8"
);
const srcRequesterHistory = readFileSync(
  join(ROOT, "src/app/dashboard/requester/page.tsx"),
  "utf8"
);
const srcAdminRequests = readFileSync(
  join(ROOT, "src/app/admin/requests/page.tsx"),
  "utf8"
);
const srcRequestActions = readFileSync(
  join(ROOT, "src/components/requests/RequestActions.tsx"),
  "utf8"
);
// The ACTION module (not the React component above) — the RS003 handling lives
// in the server action.
const srcRequestActionModule = readFileSync(
  join(ROOT, "src/lib/actions/requests.ts"),
  "utf8"
);
// Migration 0017 owns the two hardening fixes found by the Prompt 28 audit.
const sql0017 = readFileSync(
  join(ROOT, "supabase/migrations/0017_lifecycle_hardening.sql"),
  "utf8"
);
// 0004 defines the authoritative request-status CHECK. Asserting 0017 has not
// changed it is what proves no competing lifecycle was introduced.
const sql0004 = readFileSync(
  join(ROOT, "supabase/migrations/0004_blood_requests.sql"),
  "utf8"
);
// 0001 defines handle_new_user(), the signup trigger that rewrites any role
// outside the public three — the real admin-escalation defence.
const sql0001 = readFileSync(
  join(ROOT, "supabase/migrations/0001_profiles.sql"),
  "utf8"
);
const sql0010 = readFileSync(
  join(ROOT, "supabase/migrations/0010_admin_platform.sql"),
  "utf8"
);
const sql0014 = readFileSync(
  join(ROOT, "supabase/migrations/0014_platform_safety.sql"),
  "utf8"
);
const srcSafety = readFileSync(join(ROOT, "src/lib/safety.ts"), "utf8");
const srcAdminActions = readFileSync(join(ROOT, "src/lib/actions/admin.ts"), "utf8");
// Declared up here (not in section 17) because the notification-kind parity
// check above needs it to find the latest constraint definition.
const sql0016 = readFileSync(
  join(ROOT, "supabase/migrations/0016_engagement_preferences_settings.sql"),
  "utf8"
);
const srcAdminSettingsPage = readFileSync(
  join(ROOT, "src/app/admin/settings/page.tsx"),
  "utf8"
);
const srcAdminReports = readFileSync(
  join(ROOT, "src/app/admin/reports/page.tsx"),
  "utf8"
);
const srcReportForm = readFileSync(
  join(ROOT, "src/components/requests/RequestReportForm.tsx"),
  "utf8"
);
const srcSafetyForm = readFileSync(
  join(ROOT, "src/components/admin/AdminSafetyLimitsForm.tsx"),
  "utf8"
);
const sql0015 = readFileSync(
  join(ROOT, "supabase/migrations/0015_campus_blood_drives.sql"),
  "utf8"
);
const srcDrivesActions = readFileSync(join(ROOT, "src/lib/actions/drives.ts"), "utf8");
const srcDrivesList = readFileSync(join(ROOT, "src/app/drives/page.tsx"), "utf8");
const srcDriveDetail = readFileSync(join(ROOT, "src/app/drives/[id]/page.tsx"), "utf8");
const srcAdminDrives = readFileSync(join(ROOT, "src/app/admin/drives/page.tsx"), "utf8");
const srcAdminDriveDetail = readFileSync(
  join(ROOT, "src/app/admin/drives/[id]/page.tsx"),
  "utf8"
);
const srcDriveRoster = readFileSync(
  join(ROOT, "src/components/admin/AdminDriveRoster.tsx"),
  "utf8"
);
const srcDonorDashboard = readFileSync(
  join(ROOT, "src/app/dashboard/donor/page.tsx"),
  "utf8"
);
const srcNotifResolver = readFileSync(join(ROOT, "src/lib/notifications.ts"), "utf8");

const config = defaultRingConfig();
const MIN = 60_000;
/** Fake clock anchor: every scenario passes `now` explicitly. */
const T0 = Date.parse("2026-09-23T10:00:00.000Z");

function prog(row: Partial<RingProgressState> & { ringIndex: number }): RingProgressState {
  return {
    ringKm: config.ringsKm[row.ringIndex - 1] ?? 0,
    startedAt: T0,
    finishedAt: null,
    outcome: null,
    ...row,
  };
}
function mkAlert(over: Partial<AlertState> = {}): AlertState {
  return {
    id: 1,
    requestId: "req-1",
    donorId: "donor-1",
    ringKm: 3,
    status: "sent",
    dueAt: T0 + 360 * MIN,
    response: null,
    ...over,
  };
}
function mkRequest(over: Partial<RequestEngineState> = {}): RequestEngineState {
  return {
    id: "req-1",
    status: "active",
    requiredBy: T0 + 480 * MIN,
    hospitalLat: 12.9716,
    hospitalLng: 77.5946,
    bloodGroup: "A+",
    component: "whole_blood",
    progress: [],
    alerts: [],
    ...over,
  };
}

// --- 1. ring 1 starts immediately, from configuration ----------------------
check(
  "1. fresh active request starts ring 1",
  planRingTick(mkRequest(), T0),
  { kind: "start-ring", ringIndex: 1, ringKm: config.ringsKm[0] }
);
check("1. first configured ring is 3 km", config.ringsKm[0], 3);
check(
  "1. SQL engine exists and reads platform_settings rings (no hard-coded list)",
  sql0011.includes("create or replace function public.expand_alert_rings()") &&
  sql0011.includes("public.alert_rings_km()"),
  true
);
check(
  "1. engine authenticates itself with the transaction-local GUC",
  sql0011.includes("set_config('raktsetu.engine', 'on', true)") &&
  sql0011.includes("current_setting('raktsetu.engine', true) = 'on'"),
  true
);

// --- 2. ten-minute windows: wait inside, advance at the boundary -----------
const inRing1 = mkRequest({ progress: [prog({ ringIndex: 1, ringKm: 3, startedAt: T0 })] });
check(
  "2. inside ring-1 window → wait",
  planRingTick(inRing1, T0 + 9 * MIN + 59_999),
  { kind: "wait" }
);
check(
  "2. at +10 minutes → ring 2 (7 km)",
  planRingTick(inRing1, T0 + 10 * MIN),
  { kind: "start-ring", ringIndex: 2, ringKm: 7 }
);
check(
  "2. SQL gives each ring alert_window_minutes() (default 10 = constants)",
  sql0011.includes("make_interval(mins => v_window)") &&
  sql0011.includes("coalesce(public.alert_window_minutes(), 10)") &&
  ALERT_WINDOW_MINUTES === 10,
  true
);
// --- 3. exhaustion: the process stops after the final ring's window -------
const atRing3 = mkRequest({
  progress: [prog({ ringIndex: 3, ringKm: 15, startedAt: T0 + 20 * MIN })],
});
check(
  "3. inside final ring → wait",
  planRingTick(atRing3, T0 + 29 * MIN),
  { kind: "wait" }
);
check(
  "3. after final window → rings_exhausted",
  planRingTick(atRing3, T0 + 30 * MIN),
  { kind: "finish", outcome: "rings_exhausted" }
);
check(
  "3. exhausted finish is stable on repeat ticks",
  planRingTick(atRing3, T0 + 90 * MIN),
  { kind: "finish", outcome: "rings_exhausted" }
);
check(
  "3. SQL stops after ring index reaches the final configured ring",
  sql0011.includes("v_progress.ring_index >= v_total") &&
  sql0011.includes("outcome = 'rings_exhausted'"),
  true
);

// --- 4. closed or deadlined request stops immediately ----------------------
for (const status of ["fulfilled", "cancelled", "expired"] as const) {
  check(
    `4. ${status} request stops the process`,
    planRingTick(mkRequest({ status }), T0),
    { kind: "finish", outcome: "request_closed" }
  );
}
check(
  "4. passed deadline stops the process",
  planRingTick(mkRequest({ requiredBy: T0 }), T0),
  { kind: "finish", outcome: "request_closed" }
);
check(
  "4. SQL sweeps closed requests (expiry helper + non-active filter)",
  sql0011.includes("perform public.expire_stale_requests()") &&
  sql0011.includes("r.status <> 'active'") &&
  sql0011.includes("'request_closed'"),
  true
);

// --- 5. accepted donor stops expansion at once ----------------------------
const claimed = mkRequest({
  progress: [prog({ ringIndex: 1, ringKm: 3, startedAt: T0 })],
  alerts: [
    mkAlert({ id: 1, donorId: "donor-1" }),
    mkAlert({ id: 2, donorId: "donor-2", status: "responded", response: "accepted" }),
  ],
});
check(
  "5. accepted donor → finish 'accepted' (before any window logic)",
  planRingTick(claimed, T0 + 5 * MIN),
  { kind: "finish", outcome: "accepted" }
);
check(
  "5. SQL retires straggler alerts once a winner exists",
  sql0011.includes("w.response = 'accepted'") &&
  sql0011.includes("set status = 'expired'"),
  true
);

// --- 6. idempotence: repeat ticks decide the same thing, never double-send -
check(
  "6. repeat tick inside the window → wait (no second ring)",
  planRingTick(inRing1, T0 + 1 * MIN),
  { kind: "wait" }
);
const finishedEarly = mkRequest({
  progress: [
    prog({
      ringIndex: 1,
      ringKm: 3,
      startedAt: T0,
      finishedAt: T0 + 5 * MIN,
      outcome: "accepted",
    }),
  ],
});
check(
  "6. finished process keeps finishing",
  planRingTick(finishedEarly, T0 + 60 * MIN),
  { kind: "finish", outcome: "accepted" }
);
check(
  "6. SQL idempotency: PK (request_id, ring_index) + ON CONFLICT DO NOTHING",
  sql0011.includes("primary key (request_id, ring_index)") &&
  sql0011.includes("on conflict (request_id, ring_index) do nothing"),
  true
);
check(
  "6. SQL concurrency: FOR UPDATE SKIP LOCKED + finished-row guard",
  sql0011.includes("for update skip locked") &&
  sql0011.includes("p.finished_at is not null"),
  true
);
// --- 7. ring selection: already-alerted, eligibility, distance, fallback ---
const HOSP = { lat: 12.9716, lng: 77.5946 };
function cand(userId: string, over: Partial<RingCandidate> = {}): RingCandidate {
  return {
    userId,
    bloodGroup: "A+",
    availability: "available",
    lastDonationDate: null,
    latitude: HOSP.lat + 0.009, // ≈1 km north of the hospital
    longitude: HOSP.lng,
    ...over,
  };
}
// Latitude offsets ≈ km at this latitude and deliberately far from the ring
// boundaries: 0.009°≈1.0 km, 0.054°≈6.0 km, 0.117°≈12.9 km, 0.198°≈21.9 km.
const selRequest: RingRequestShape = {
  status: "active",
  bloodGroup: "A+",
  component: "whole_blood",
  hospitalLat: HOSP.lat,
  hospitalLng: HOSP.lng,
};
const pool: RingCandidate[] = [
  cand("cNoLoc", { latitude: null, longitude: null }),
  cand("cOut", { latitude: HOSP.lat + 0.198 }),
  cand("cIn3", { latitude: HOSP.lat + 0.117 }),
  cand("cIn2", { latitude: HOSP.lat + 0.054 }),
  cand("cPaused", { availability: "temporarily_unavailable" }),
  cand("cCooldown", { lastDonationDate: "2026-09-18" }), // 5 days ago → cooling
  cand("cWrong", { bloodGroup: "B+" }), // incompatible with A+ whole blood
  cand("cSuspended", { accountActive: false }),
  cand("cAlerted"), // already alerted for this request
  cand("cIn1"),
];
const priorAlerts = ["cAlerted"];

check(
  "7. ring 3 → only donors inside 3 km (filters + closest first)",
  selectRingDonors(selRequest, pool, priorAlerts, 3),
  ["cIn1"]
);
check(
  "7. ring 7 → donors inside 7 km, closest first",
  selectRingDonors(selRequest, pool, priorAlerts, 7),
  ["cIn1", "cIn2"]
);
check(
  "7. ring 15 → donors inside 15 km",
  selectRingDonors(selRequest, pool, priorAlerts, 15),
  ["cIn1", "cIn2", "cIn3"]
);
check(
  "7. already-alerted donors are never re-alerted in a later ring",
  selectRingDonors(selRequest, pool, [...priorAlerts, "cIn1"], 7),
  ["cIn2"]
);
check(
  "7. no hospital pin → distance unknown: every eligible donor qualifies, unknown last",
  selectRingDonors(
    { ...selRequest, hospitalLat: null, hospitalLng: null },
    pool,
    priorAlerts,
    15
  ),
  ["cIn1", "cIn2", "cIn3", "cNoLoc", "cOut"]
);
check(
  "7. inactive request selects nobody",
  selectRingDonors({ ...selRequest, status: "fulfilled" }, pool, priorAlerts, 15),
  []
);
check(
  "7. SQL: fresh match per ring minus already-alerted, UNIQUE (request, donor) blocks duplicates",
  sql0011.includes("match_donors_for_request(v_request.id, v_radius, 50) m") &&
  sql0011.includes("a.donor_id = m.user_id") &&
  sql0011.includes("on conflict (request_id, donor_id) do nothing"),
  true
);
check(
  "7. SQL match: radius excludes unprovable distance; closest first, stable tie-break",
  sql0011.includes("c.dist is not null and c.dist <= v_radius") &&
  sql0011.includes("order by c.dist asc nulls last, c.user_id asc"),
  true
);
check(
  "7. UNIQUE (request_id, donor_id) exists in migration 0008",
  sql0008.includes("(request_id, donor_id)") ||
  sql0008.includes("(donor_id, request_id)"),
  true
);
check(
  "7. donors read only their OWN alert rows (own-row RLS restored by 0011)",
  sql0011.includes("using (auth.uid() = donor_id)"),
  true
);

// --- 8. due_at: configured offset before the deadline, clamped -------------
check(
  "8. due_at = 120 min before the deadline",
  computeAlertDueAt(T0 + 480 * MIN, T0),
  T0 + 360 * MIN
);
check(
  "8. inside the offset window → clamped to the deadline (never past-due)",
  computeAlertDueAt(T0 + 480 * MIN, T0 + 400 * MIN),
  T0 + 480 * MIN
);
check(
  "8. exactly at the offset boundary → the deadline itself",
  computeAlertDueAt(T0 + 480 * MIN, T0 + 360 * MIN),
  T0 + 480 * MIN
);
check(
  "8. offset default 120 mirrored in SQL",
  ALERT_DUE_AT_OFFSET_MINUTES === 120 &&
  sql0011.includes("coalesce(public.alert_due_at_offset_minutes(), 120)"),
  true
);
const dueNeedle = "when v_request.required_by - make_interval(mins => v_offset) <= now()";
check(
  "8. SQL due CASE appears in BOTH the engine and mark_alert_responded",
  sql0011.split(dueNeedle).length - 1 >= 2,
  true
);
// --- 9. acceptance: exact outcome codes in SQL order, first one wins -------
const donor: EligibilityDonor = {
  availability: "available",
  lastDonationDate: null,
  bloodGroup: "A+",
  accountActive: true,
};
const openAlert = mkAlert();
const baseReq = mkRequest({ alerts: [openAlert] });
const winnerReq = mkRequest({
  alerts: [
    mkAlert({ id: 2, donorId: "donor-2", status: "responded", response: "accepted" }),
    openAlert,
  ],
});

check(
  "9. invalid response value",
  resolveAcceptance(baseReq, openAlert, donor, "donor-1", "maybe" as never, T0).outcome,
  "invalid_response"
);
check(
  "9. unknown alert",
  resolveAcceptance(baseReq, null, donor, "donor-1", "accepted", T0).outcome,
  "not_found"
);
check(
  "9. another donor's alert",
  resolveAcceptance(baseReq, openAlert, donor, "donor-2", "accepted", T0).outcome,
  "not_your_alert"
);
check(
  "9. already responded",
  resolveAcceptance(
    baseReq,
    mkAlert({ status: "responded", response: "declined" }),
    donor,
    "donor-1",
    "accepted",
    T0
  ).outcome,
  "already_responded"
);
check(
  "9. FIRST acceptance wins: the second donor gets already_taken",
  resolveAcceptance(winnerReq, openAlert, donor, "donor-1", "accepted", T0).outcome,
  "already_taken"
);
check(
  "9. winner check outranks an expired alert (SQL ordering)",
  resolveAcceptance(winnerReq, mkAlert({ dueAt: T0 - 1 }), donor, "donor-1", "accepted", T0)
    .outcome,
  "already_taken"
);
check(
  "9. retired alert → request_closed",
  resolveAcceptance(baseReq, mkAlert({ status: "expired" }), donor, "donor-1", "accepted", T0)
    .outcome,
  "request_closed"
);
check(
  "9. past due_at → alert_expired",
  resolveAcceptance(baseReq, mkAlert({ dueAt: T0 }), donor, "donor-1", "accepted", T0).outcome,
  "alert_expired"
);
check(
  "9. closed request → request_closed",
  resolveAcceptance(
    mkRequest({ status: "fulfilled" }),
    openAlert,
    donor,
    "donor-1",
    "accepted",
    T0
  ).outcome,
  "request_closed"
);
check(
  "9. re-eligibility: paused donor → not_eligible",
  resolveAcceptance(
    baseReq,
    openAlert,
    { ...donor, availability: "temporarily_unavailable" },
    "donor-1",
    "accepted",
    T0
  ).outcome,
  "not_eligible"
);
check(
  "9. re-eligibility: still on cooldown → not_eligible",
  resolveAcceptance(
    baseReq,
    openAlert,
    { ...donor, lastDonationDate: "2026-09-18" },
    "donor-1",
    "accepted",
    T0
  ).outcome,
  "not_eligible"
);
check(
  "9. re-eligibility: suspended account → not_eligible",
  resolveAcceptance(
    baseReq,
    openAlert,
    { ...donor, accountActive: false },
    "donor-1",
    "accepted",
    T0
  ).outcome,
  "not_eligible"
);
check(
  "9. re-eligibility: incompatible group → not_eligible",
  resolveAcceptance(baseReq, openAlert, { ...donor, bloodGroup: "B+" }, "donor-1", "accepted", T0)
    .outcome,
  "not_eligible"
);

const accepted = resolveAcceptance(baseReq, openAlert, donor, "donor-1", "accepted", T0);
check("9. eligible acceptance wins", accepted.outcome, "accepted");
check(
  "9. acceptance records responded state at the injected clock",
  accepted.responded,
  { status: "responded", response: "accepted", respondedAt: T0 }
);
check(
  "9. contact window follows the due-at rule",
  accepted.contactSharedUntil,
  T0 + 360 * MIN
);
const declined = resolveAcceptance(baseReq, openAlert, donor, "donor-1", "declined", T0);
check(
  "9. decline is durable and opens no contact window",
  { outcome: declined.outcome, until: declined.contactSharedUntil },
  { outcome: "declined", until: null }
);
check(
  "9. actionable gate mirrors SQL guards (open, not due, unanswered)",
  [
    isAlertActionable(openAlert, T0),
    isAlertActionable({ ...openAlert, dueAt: T0 }, T0),
    isAlertActionable({ ...openAlert, response: "declined" }, T0),
    isAlertActionable({ ...openAlert, status: "expired" }, T0),
  ],
  [true, false, false, false]
);
const markBody = sql0011.slice(
  sql0011.indexOf("create or replace function public.mark_alert_responded")
);
check(
  "9. SQL locks BOTH request and alert rows (request first)",
  (markBody.match(/for update/g) ?? []).length >= 2 &&
  markBody.indexOf("from public.blood_requests") < markBody.indexOf("from public.donor_alerts"),
  true
);
check(
  "9. SQL check order: winner → status → due → eligibility",
  markBody.indexOf("w.response = 'accepted'") !== -1 &&
  markBody.indexOf("w.response = 'accepted'") < markBody.indexOf("v_alert.status not in") &&
  markBody.indexOf("v_alert.status not in") < markBody.indexOf("v_alert.due_at <= now()") &&
  markBody.indexOf("v_alert.due_at <= now()") < markBody.indexOf("donor_directory d"),
  true
);
// --- 10. privacy: nothing but a winning acceptance opens contact -----------
const noWindow: AcceptanceResult[] = [
  resolveAcceptance(baseReq, null, donor, "donor-1", "accepted", T0),
  resolveAcceptance(baseReq, openAlert, donor, "donor-2", "accepted", T0),
  resolveAcceptance(winnerReq, openAlert, donor, "donor-1", "accepted", T0),
  resolveAcceptance(baseReq, mkAlert({ dueAt: T0 }), donor, "donor-1", "accepted", T0),
  resolveAcceptance(
    baseReq,
    openAlert,
    { ...donor, accountActive: false },
    "donor-1",
    "accepted",
    T0
  ),
  declined,
];
check(
  "10. failure and decline results NEVER carry a contact window",
  noWindow.every((r) => r.contactSharedUntil === null),
  true
);
check(
  "10. only decline/acceptance record responded state; failures record nothing",
  noWindow.map((r) => r.responded !== null),
  [false, false, false, false, false, true]
);
check(
  "10. reveal_accepted_donors: requester-only, post-acceptance, time-boxed, anon-revoked",
  sql0011.includes("r.requester_id = auth.uid()") &&
  sql0011.includes("a.contact_shared_until > now()") &&
  sql0011.includes(
    "revoke all on function public.reveal_accepted_donors(uuid[]) from public, anon"
  ),
  true
);
check(
  "10. donor queue shows requester contact only inside the caller's own accepted alert",
  sql0011.includes("case when a.response = 'accepted' and a.contact_shared_until > now()") &&
  sql0011.includes("where a.donor_id = auth.uid()"),
  true
);
check(
  "10. notifications are emitters-only: writes revoked from clients, own-row reads",
  sql0011.includes(
    "revoke insert, update, delete on table public.notifications from authenticated"
  ) &&
  sql0011.includes("using (auth.uid() = user_id)") &&
  sql0011.includes("No INSERT/DELETE policy on purpose"),
  true
);
// --- 11. SQL ↔ TS parity: one behaviour, two mirrors -----------------------
const srcRingEngine = readFileSync(join(ROOT, "src/lib/ring-engine.ts"), "utf8");
const OUTCOME_CODES = [
  "accepted",
  "declined",
  "invalid_response",
  "not_found",
  "not_your_alert",
  "already_responded",
  "already_taken",
  "request_closed",
  "alert_expired",
  "not_eligible",
];
check(
  "11. every outcome code exists in SQL, the TS engine, and the server action",
  OUTCOME_CODES.every(
    (c) =>
      sql0011.includes(`'${c}'`) &&
      srcEngine.includes(`"${c}"`) &&
      srcAlerts.includes(`${c}:`)
  ),
  true
);
check(
  "11. NO 'accepted' request status was introduced (lifecycle unchanged)",
  JSON.stringify(Object.keys(REQUEST_STATUS_LABELS).sort()) ===
  JSON.stringify(["active", "cancelled", "expired", "fulfilled"]),
  true
);
check(
  "11. ring defaults: constants 3,7,15 == SQL engine fallback array[3, 7, 15]",
  ALERT_RINGS_KM.join(", ") === "3, 7, 15" &&
  sql0011.includes("alert_rings_km(), array[3, 7, 15]"),
  true
);
check(
  "11. ring labels cover every configured ring",
  ALERT_RINGS_KM.every((km) => typeof ALERT_RING_LABELS[km] === "string"),
  true
);
check(
  "11. window/offset defaults: constants == SQL fallbacks",
  ALERT_WINDOW_MINUTES === 10 &&
  ALERT_DUE_AT_OFFSET_MINUTES === 120 &&
  sql0011.includes("coalesce(public.alert_window_minutes(), 10)") &&
  sql0011.includes("coalesce(public.alert_due_at_offset_minutes(), 120)"),
  true
);
check(
  "11. all engine functions are defined by the migration",
  [
    "expand_alert_rings",
    "mark_alert_responded",
    "donor_active_alerts",
    "reveal_accepted_donors",
    "admin_ring_progress",
    "requester_ring_status",
    "notify_user",
    "emit_alert_received",
  ].every((fn) => sql0011.includes(`create or replace function public.${fn}`)),
  true
);
check(
  "11. pg_cron ticks the engine every minute (guarded install)",
  sql0011.includes("'raktsetu-alert-rings'") && sql0011.includes("'* * * * *'"),
  true
);
check(
  "11. opportunistic app-side tick exists for pg_cron-less environments",
  srcRingEngine.includes("expand_alert_rings"),
  true
);
check(
  "11. smoke suite exercises /notifications",
  smoke.includes("/notifications"),
  true
);

// --- 12. donor-experience security regression (migration 0012) -------------
const donorQueueAt = sql0012.indexOf(
  "create or replace function public.donor_active_alerts"
);
const donorQueueBody = sql0012.slice(donorQueueAt);
const donorQueueHead = donorQueueBody.slice(
  0,
  donorQueueBody.indexOf("language plpgsql")
);
const donorHistoryBody = sql0012.slice(
  sql0012.indexOf("create or replace function public.donor_donation_history")
);
const NOTIFIER_FNS_0012 = [
  "emit_alert_expiring",
  "emit_alert_claimed",
  "emit_request_closeout",
  "sync_donor_profile_from_donation",
  "emit_eligibility_updated",
  "donor_donation_history",
];
check(
  "12. 0012 exists and never alters the request lifecycle (no 'accepted' status)",
  sql0012.includes("-- End of migration 0012_donor_experience.sql.") &&
  !sql0012.includes("alter table public.blood_requests"),
  true
);
check(
  "12. request status type still has exactly the four lifecycle values",
  srcTypes.includes(
    'export type BloodRequestStatus = "active" | "fulfilled" | "expired" | "cancelled";'
  ),
  true
);
check(
  "12. donor queue: own-row gate intact; only an approximate distance — never coordinates",
  donorQueueAt !== -1 &&
  donorQueueBody.includes("where a.donor_id = auth.uid()") &&
  sql0012.includes("approx_distance_km") &&
  sql0012.includes("public.haversine_km(") &&
  !donorQueueHead.includes("latitude") &&
  !donorQueueHead.includes("longitude"),
  true
);
check(
  "12. every 0012 function is SECURITY DEFINER with a pinned search_path",
  NOTIFIER_FNS_0012.every((fn) => {
    const at = sql0012.indexOf(`create or replace function public.${fn}`);
    if (at === -1) return false;
    const seg = sql0012.slice(at, sql0012.indexOf("$$;", at));
    return (
      seg.includes("security definer") && seg.includes("set search_path = public")
    );
  }),
  true
);
check(
  "12. 0012 emitters are revoked from clients; notifications gain no insert grant",
  NOTIFIER_FNS_0012.every((fn) =>
    sql0012.includes(`revoke all on function public.${fn}`)
  ) && !sql0012.includes("grant insert on table public.notifications"),
  true
);
check(
  "12. all six new notification kinds are in the widened kind constraint",
  [
    "alert_expiring",
    "already_accepted",
    "request_fulfilled",
    "request_cancelled",
    "request_expired",
    "eligibility_updated",
  ].every((k) => sql0012.includes(`'${k}'`)),
  true
);
check(
  "12. already-claimed notice: only open→expired, only while request active with a winner",
  sql0012.includes(
    "old.status in ('queued', 'sent', 'opened') and new.status = 'expired'"
  ) &&
  sql0012.includes("r.status <> 'active'") &&
  sql0012.includes("w.response = 'accepted'") &&
  sql0012.includes("'already_accepted'"),
  true
);
check(
  "12. request close-out: one-shot active→terminal guard, retires open alerts, specific kinds",
  sql0012.includes("old.status = 'active'") &&
  sql0012.includes("new.status in ('fulfilled', 'cancelled', 'expired')") &&
  sql0012.includes("'request_' || new.status") &&
  sql0012.includes("d.status in ('queued', 'sent', 'opened')"),
  true
);
check(
  "12. expiring nudge: single-shot guard, open-only, never past due; 15 min mirrored in SQL and TS",
  ALERT_EXPIRING_NOTICE_MINUTES === 15 &&
  sql0012.includes("make_interval(mins => 15)") &&
  sql0012.includes("a.expiring_notified_at is null") &&
  sql0012.includes("a.due_at > now()") &&
  sql0012.includes("for update of a skip locked") &&
  srcRingEngine.includes("emit_alert_expiring"),
  true
);
check(
  "12. eligibility notice fires only when the recorded donation date actually changes",
  sql0012.includes(
    "old.last_donation_date is distinct from new.last_donation_date"
  ) &&
  sql0012.includes("'eligibility_updated'") &&
  sql0012.includes("public.donation_interval_days()"),
  true
);
check(
  "12. admin-recorded donations sync last_donation_date + donation_count (cooldown starts)",
  sql0012.includes("after insert on public.donation_history") &&
  sql0012.includes("select count(*)::int from public.donation_history") &&
  sql0012.includes("last_donation_date < new.donated_on"),
  true
);
check(
  "12. donation history: donor-own only, role-checked, never requester contact",
  donorHistoryBody.includes("h.donor_id = auth.uid()") &&
  donorHistoryBody.includes("p.role = 'donor'") &&
  !donorHistoryBody.includes("contact_phone") &&
  !donorHistoryBody.includes("contact_name"),
  true
);
check(
  "12. dashboard availability still flows through the validated server action",
  srcDonorAction.includes("validateAvailability") &&
  srcDonorControl.includes("updateDonorProfile") &&
  srcDonorControl.includes('name="availability"'),
  true
);
check(
  "12. donor alert UI responds only via respondToAlert (no direct RPC) and renders no coordinates",
  srcDonorCard.includes("respondToAlert") &&
  !srcDonorCard.includes("supabase.rpc") &&
  !srcDonorCard.includes("latitude") &&
  !srcDonorCard.includes("longitude"),
  true
);
check(
  "12. requester contact still only through the time-boxed accepted-alert gate",
  sql0012.includes(
    "case when a.response = 'accepted' and a.contact_shared_until > now()"
  ),
  true
);

// --- 13. notification centre & event consistency (migration 0013) ----------
// The authoritative kind list is the LAST migration to (re)define the check
// constraint, because every widening re-states the complete set. 0015 re-adds
// it with the campus-drive kinds, so reading 0013 alone would report TS↔SQL as
// out of parity the moment a drive kind is added.
const kindBlockMarker = "add constraint notifications_kind_check check (kind in (";
const kindSources = [sql0013, sql0015, sql0016].filter((s) => s.includes(kindBlockMarker));
const lastKindSource = kindSources[kindSources.length - 1] ?? "";
const kindBlockAt = lastKindSource.indexOf(kindBlockMarker);
const kindBlock = lastKindSource.slice(
  kindBlockAt,
  lastKindSource.indexOf("));", kindBlockAt)
);
const sqlKinds = [...kindBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
check(
  "13. TS and SQL agree on every notification kind (one kind per logical event)",
  kindSources.length > 0 &&
  kindBlockAt !== -1 &&
  JSON.stringify([...sqlKinds].sort()) ===
  JSON.stringify([...NOTIFICATION_KINDS].sort()),
  true
);
check(
  "13. every kind has a human label and an unknown kind degrades safely",
  NOTIFICATION_KINDS.every(
    (kind) => typeof NOTIFICATION_KIND_LABELS[kind] === "string"
  ) && notificationKindLabel("brand_new_kind") === "Update",
  true
);
check(
  "13. the NotificationKind union lists every kind the database accepts",
  NOTIFICATION_KINDS.every((kind) => srcTypes.includes(`"${kind}"`)),
  true
);

// Duplicate prevention must live in the database (a retried action, a second
// scheduler run, a page refresh, or a re-transition must not double-notify).
check(
  "13. duplicates are prevented in SQL by a stable event key, not by the UI",
  sql0013.includes("create unique index if not exists notifications_event_once_uidx") &&
  sql0013.includes(
    "coalesce(request_id, '00000000-0000-0000-0000-000000000000'::uuid)"
  ) &&
  sql0013.includes("coalesce(alert_id, 0)") &&
  sql0013.includes("before insert on public.notifications") &&
  sql0013.includes("return null;"),
  true
);
check(
  "13. only the intentionally repeatable kinds are exempt from the event key",
  sql0013.includes("where kind not in (") &&
  sql0013.includes("'eligibility_updated'") &&
  sql0013.includes("'admin_report_received'") &&
  sql0013.includes("'account_status_changed'") &&
  sql0013.includes("if new.kind in ("),
  true
);
check(
  "13. the guard covers every insert path, including the 0011 closure sweep",
  sql0013.includes("for each row execute function public.skip_duplicate_notification()") &&
  (sql0011.match(/insert into public\.notifications/g) ?? []).length >= 2 &&
  !sql0013.includes("create or replace function public.expand_alert_rings"),
  true
);
check(
  "13. the list rendering never filters duplicates client-side",
  !srcNotifLive.includes("new Set(") && !srcNotifItem.includes("new Set("),
  true
);

// Read state is per recipient, and unread counts are database facts.
check(
  "13. the unread count is an exact database count for this recipient",
  srcNotifServer.includes('count: "exact"') &&
  srcNotifServer.includes('head: true') &&
  srcNotifServer.includes('.eq("user_id", userId)') &&
  srcNotifServer.includes('.is("read_at", null)') &&
  srcNotifPage.includes("getUnreadNotificationCount"),
  true
);
check(
  "13. the rendered list can never under-report unread state",
  srcNotifPage.includes("Math.max(") &&
  countUnreadNotifications([
    { read_at: null },
    { read_at: "2026-09-23T10:00:00.000Z" },
    { read_at: null },
  ]) === 2,
  true
);
check(
  "13. marking read is own-row only — another user's copy is untouched",
  srcNotifActions.includes('.eq("id", notificationId)') &&
  srcNotifActions.includes('.eq("user_id", session.user.id)') &&
  srcNotifActions.includes('.is("read_at", null)') &&
  srcNotifActions.includes("markNotificationRead") &&
  srcNotifActions.includes("markAllNotificationsRead") &&
  sql0011.includes("using (auth.uid() = user_id)"),
  true
);


// Notification routing: only existing, role-appropriate pages.
const NREQ = "11111111-1111-1111-1111-111111111111";
function notif(
  kind: NotificationLike["kind"],
  requestId: string | null = null,
  alertId: number | null = null,
  link: string | null = null,
  driveId: string | null = null,
  dedupeKey: string | null = null
): NotificationLike {
  return {
    kind,
    request_id: requestId,
    alert_id: alertId,
    link,
    drive_id: driveId,
    dedupe_key: dedupeKey,
  };
}
check(
  "13. requester notifications open the existing request details page",
  resolveNotificationDestination(notif("donor_accepted", NREQ), "requester"),
  { href: `/requests/${NREQ}`, label: "Open request" }
);
check(
  "13. donor alert notifications deep-link to that donor's own alert card",
  resolveNotificationDestination(notif("alert_received", NREQ, 7), "donor"),
  { href: "/dashboard/donor#alert-7", label: "Open alerts" }
);
check(
  "13. a closed alert never anchors a card that is no longer rendered",
  resolveNotificationDestination(notif("request_fulfilled", NREQ, 7), "donor"),
  { href: "/dashboard/donor", label: "Open donor dashboard" }
);
check(
  "13. volunteer notifications open the existing volunteer request page",
  resolveNotificationDestination(notif("assisted_request_fulfilled", NREQ), "volunteer"),
  { href: `/volunteer/requests/${NREQ}`, label: "Open request" }
);
check(
  "13. admin notifications open the existing admin console pages",
  [
    resolveNotificationDestination(notif("admin_report_received", NREQ), "admin"),
    resolveNotificationDestination(notif("alert_received", NREQ, 9), "admin"),
    resolveNotificationDestination(notif("request_expired", NREQ), "admin"),
  ],
  [
    { href: "/admin/reports", label: "Open reports queue" },
    { href: "/admin/alerts", label: "Open alert monitor" },
    { href: "/admin/requests", label: "Open requests" },
  ]
);
check(
  "13. no destination is invented when the viewer cannot read the page",
  [
    resolveNotificationDestination(notif("request_created", NREQ), "donor"),
    resolveNotificationDestination(notif("alert_received", NREQ, 3), "requester"),
    resolveNotificationDestination(notif("eligibility_updated"), "volunteer"),
  ],
  [{ href: "/dashboard/donor", label: "Open donor dashboard" }, null, null]
);
check(
  "13. only internal, shape-validated stored links are ever followed",
  [
    resolveNotificationDestination(
      notif("eligibility_updated", null, null, "https://evil.example/x"),
      null
    ),
    resolveNotificationDestination(
      notif("eligibility_updated", null, null, "/notifications"),
      null
    ),
  ],
  [null, { href: "/notifications", label: "Open" }]
);
check(
  "13. no notification-specific detail route was invented",
  !existsSync(join(ROOT, "src/app/notifications/[id]")) &&
  existsSync(join(ROOT, "src/components/notifications/NotificationsLive.tsx")),
  true
);

// Privacy: notification text carries no contact data or coordinates.
check(
  "13. no emitter copies private contact data, coordinates, or free-text notes",
  !/contact_phone|contact_name/.test(sql0013) &&
  !/latitude|longitude/.test(sql0013) &&
  !sql0013.includes("new.details") &&
  sql0013.includes("new.hospital_locality"),
  true
);

// Cleanup: conservative, bounded, unread-safe, no new infrastructure.
check(
  "13. retention deletes read rows only, bounded and clamped, never unread",
  sql0013.includes("where n.read_at is not null") &&
  sql0013.includes("and n.created_at < now() - make_interval(days => v_days)") &&
  sql0013.includes("limit v_limit") &&
  sql0013.includes("least(greatest(coalesce(p_retain_days, 90), 30), 3650)") &&
  sql0013.includes("not public.is_current_user_admin()") &&
  !/delete from public\.notifications[\s\S]{0,240}read_at is null/.test(sql0013),
  true
);
check(
  "13. retention reuses the already-installed scheduler (no new infrastructure)",
  sql0013.includes("'raktsetu-notifications-prune'") &&
  sql0013.includes("to_regnamespace('cron') is not null") &&
  sql0013.includes("cron.schedule("),
  true
);
check(
  "13. retention actually holds the operationally important kinds for longer",
  sql0013.includes("v_important_days := least(greatest(v_days * 4, 365), 3650)") &&
  sql0013.includes(
    "or n.created_at < now() - make_interval(days => v_important_days)"
  ) &&
  sql0013.includes("'admin_report_received'") &&
  sql0013.includes("'account_status_changed'"),
  true
);

// A PL/pgSQL variable that is assigned but never DECLARED is a compile error:
// the whole migration would fail to apply, silently taking every 0013 emitter,
// index, RLS policy and retention job with it. No TypeScript check can see
// this, so assert it structurally for every function the migration creates.
{
  const undeclaredAssignments: string[] = [];
  const fnBlocks = [
    ...sql0013.matchAll(
      /create or replace function\s+public\.(\w+)[\s\S]*?\bas\s+\$\$([\s\S]*?)\$\$;/g
    ),
  ];
  for (const match of fnBlocks) {
    const fn = match[1] ?? "unknown";
    const body = match[2] ?? "";
    const declaredAt = body.indexOf("declare");
    const beginAt = body.indexOf("\nbegin", declaredAt === -1 ? 0 : declaredAt);
    // Text before DECLARE is the signature, not the executable body.
    const declaredBlock =
      declaredAt === -1 ? "" : body.slice(declaredAt, beginAt === -1 ? undefined : beginAt);
    const execBlock = beginAt === -1 ? body : body.slice(beginAt);
    const declared = new Set(
      [
        ...declaredBlock.matchAll(
          /^\s*(\w+)\s+(?:integer|bigint|text|uuid|boolean|timestamptz|jsonb|record|int)\b/gm
        ),
      ].map((d) => d[1])
    );
    const assigned = new Set([
      ...[...execBlock.matchAll(/\b(v_\w+)\s*:=/g)].map((a) => a[1]),
      ...[...execBlock.matchAll(/\binto\s+((?:v_\w+\s*,\s*)*v_\w+)/gi)].flatMap((a) =>
        (a[1] ?? "")
          .split(",")
          .map((name) => name.trim())
      ),
    ]);
    for (const name of assigned) {
      if (!declared.has(name)) undeclaredAssignments.push(`${fn}:${name}`);
    }
  }
  check(
    "13. every 0013 function declares each local variable it assigns (migration applies cleanly)",
    fnBlocks.length > 0 && undeclaredAssignments.length === 0,
    true
  );
  if (undeclaredAssignments.length > 0) {
    console.error(
      `      undeclared PL/pgSQL variables: ${undeclaredAssignments.join(", ")}`
    );
  }
}


// Event mapping: every required event has exactly one emitter.
check(
  "13. every required donor/requester/volunteer/admin event has an emitter",
  [
    sql0011.includes("after insert on public.donor_alerts") &&
    sql0011.includes("'alert_received'"),
    sql0011.includes("'donor_accepted'"),
    sql0012.includes("'already_accepted'"),
    sql0012.includes("'alert_expiring'"),
    sql0012.includes("'request_' || new.status"),
    sql0012.includes("'eligibility_updated'"),
    sql0013.includes("'request_created'") &&
    sql0013.includes("'/requests/' || new.id::text"),
    sql0013.includes("'request_' || new.status") &&
    sql0013.includes("new.requester_id"),
    sql0013.includes("'volunteer_request_nearby'"),
    sql0013.includes("'assisted_request_accepted'"),
    sql0013.includes("'assisted_request_' || new.status"),
    sql0013.includes("'admin_report_received'"),
    sql0013.includes("'acceptance_confirmed'") &&
    sql0013.includes("'/dashboard/donor'"),
    sql0013.includes("'account_status_changed'") &&
    sql0013.includes("'/profile'"),
  ].every(Boolean),
  true
);
const NOTIFIER_FNS_0013 = [
  "skip_duplicate_notification",
  "emit_request_created",
  "emit_request_closeout",
  "emit_assisted_request_accepted",
  "emit_admin_report_received",
  "emit_acceptance_confirmed",
  "emit_account_status_changed",
  "prune_read_notifications",
];
check(
  "13. every 0013 function is SECURITY DEFINER, pinned, and revoked from clients",
  NOTIFIER_FNS_0013.every((fn) => {
    const at = sql0013.indexOf(`create or replace function public.${fn}`);
    if (at === -1) return false;
    const seg = sql0013.slice(at, sql0013.indexOf("$$;", at));
    return (
      seg.includes("security definer") &&
      seg.includes("set search_path = public") &&
      sql0013.includes(`revoke all on function public.${fn}`)
    );
  }) &&
  !sql0013.includes("grant insert on table public.notifications") &&
  !sql0013.includes("grant update on table public.notifications"),
  true
);
check(
  "13. 0013 never alters the lifecycle, the ring engine, or the acceptance model",
  sql0013.includes("-- End of migration 0013_notification_consistency.sql.") &&
  !sql0013.includes("alter table public.blood_requests") &&
  !sql0013.includes("create or replace function public.mark_alert_responded") &&
  !sql0013.includes("create or replace function public.expand_alert_rings") &&
  !sql0013.includes("drop function"),
  true
);

// Mobile UX: readable, tappable, wrapping, no decorative bloat.
check(
  "13. the centre is mobile-usable: 44px tap targets, wrapping text, real times",
  srcNotifItem.includes("min-h-11") &&
  srcNotifItem.includes("break-words") &&
  srcNotifItem.includes("flex-wrap") &&
  srcNotifItem.includes("dateTime={item.created_at}") &&
  srcNotifLive.includes("flex-wrap"),
  true
);
check(
  "13. unread rows are marked by more than colour and can be read individually",
  srcNotifItem.includes("Unread") &&
  srcNotifItem.includes("Mark as read") &&
  srcNotifLive.includes("Mark all as read") &&
  srcNotifItem.includes('unread ? "glass-blood" : "glass"'),
  true
);
check(
  "13. one shared centre for every role, with a DB-backed shell badge",
  srcNotifPage.includes("role={session.profile?.role ?? null}") &&
  srcNavbar.includes('href="/notifications"') &&
  srcNavbar.includes("UnreadBadge") &&
  srcLayout.includes("getUnreadNotificationCount"),
  true
);
check(
  "13. a destination link is rendered only when one exists",
  srcNotifItem.includes("destination && (") &&
  srcNotifItem.includes("destination.href"),
  true
);

// --- 14 · request search, filtering & history --------------------------------
// One shared model, two role-gated surfaces: requester history owns its rows,
// admin oversight stays behind the existing admin gate. Closed rows are
// read-only; lifecycle mutations live only in lib/actions/requests.ts.
check(
  "14. requester history is database-filtered over own rows only",
  srcRequesterHistory.includes('.eq("requester_id", user.id)') &&
  srcRequesterHistory.includes("parseRequestFilters(await searchParams)") &&
  srcRequesterHistory.includes('.eq("status", filters.status)') &&
  srcRequesterHistory.includes('.eq("blood_group", filters.bloodGroup)') &&
  srcRequesterHistory.includes('.eq("blood_component", filters.component)') &&
  srcRequesterHistory.includes('.eq("urgency", filters.urgency)') &&
  srcRequesterHistory.includes('.gte("created_at"') &&
  srcRequesterHistory.includes('.lte("created_at"') &&
  srcRequesterHistory.includes(".range(from, from + PAGE_SIZE - 1)"),
  true
);
check(
  "14. admin oversight is role-gated with bounded database queries",
  srcAdminRequests.includes('requireRolePage("admin")') &&
  srcAdminRequests.includes('parseRequestFilters(await searchParams, { allowSearch: true })') &&
  srcAdminRequests.includes('.eq("status", filters.status)') &&
  srcAdminRequests.includes('.eq("blood_group", filters.bloodGroup)') &&
  srcAdminRequests.includes('.eq("blood_component", filters.component)') &&
  srcAdminRequests.includes('.eq("urgency", filters.urgency)') &&
  srcAdminRequests.includes('.gte("created_at"') &&
  srcAdminRequests.includes('.lte("created_at"') &&
  srcAdminRequests.includes("hospital_name.ilike.") &&
  srcAdminRequests.includes("hospital_locality.ilike.") &&
  srcAdminRequests.includes(".range(from, from + PAGE_SIZE - 1)"),
  true
);
check(
  "14. requester history exposes the full model + all required filters and sorts",
  srcRequestTable.includes("formatDateTime(r.required_by)") &&
  srcRequestTable.includes("formatDateTime(r.created_at)") &&
  srcRequestTable.includes("BLOOD_COMPONENT_LABELS") &&
  srcRequestTable.includes("REQUEST_STATUS_LABELS") &&
  srcRequestTable.includes("URGENCY_LABELS") &&
  srcRequestFilters.includes('"active"') &&
  srcRequestFilters.includes('"fulfilled"') &&
  srcRequestFilters.includes('"expired"') &&
  srcRequestFilters.includes('"cancelled"') &&
  srcRequestFilters.includes('"newest"') &&
  srcRequestFilters.includes('"required_by"') &&
  srcRequestFilters.includes('"urgent"'),
  true
);
check(
  "14. tables link to existing detail pages; closed rows render no lifecycle actions",
  srcRequesterHistory.includes("detailsHref={(id) => `/requests/${id}`}") &&
  srcRequesterHistory.includes("RequestTable") &&
  srcRequestTable.includes("detailsHref") &&
  !srcRequestTable.includes("cancelBloodRequest") &&
  !srcRequestTable.includes("fulfillBloodRequest") &&
  srcRequestActions.includes("cancelBloodRequest") &&
  srcRequestActions.includes("fulfillBloodRequest"),
  true
);
check(
  "14. filters are whitelisted, paginated, and never client-filtered",
  srcRequestFilters.includes("Unknown values fall back") &&
  srcFilterBar.includes('method="get"') &&
  srcRequestPager.includes("filtersToSearchParams") &&
  !srcRequestTable.includes(".filter(") &&
  !srcFilterBar.includes("useState"),
  true
);
check(
  "14. history UX: truncated long names, missing-note copy, and real empty states",
  srcRequestTable.includes("truncate") &&
  srcRequestTable.includes("No note added") &&
  srcRequestTable.includes("emptyTitle") &&
  srcRequesterHistory.includes("No requests match these filters") &&
  srcRequesterHistory.includes("No request history yet") &&
  srcAdminRequests.includes("No requests match these filters"),
  true
);
check(
  "14. no second request-management system: no new table, service, or lifecycle writes",
  !srcRequestFilters.includes("create table") &&
  !srcRequestFilters.includes("update(") &&
  !srcRequestTable.includes("cancelBloodRequest") &&
  !srcAdminRequests.includes("cancelBloodRequest") &&
  !srcAdminRequests.includes("fulfillBloodRequest") &&
  !srcAdminRequests.includes("supabase.rpc("),
  true
);

// --- 15. platform safety: reporting, moderation and abuse controls ----------
// The 0010 grant defect this guards against is subtle and total: 0010 revoked
// UPDATE on request_reports and never granted it back, so the "Admins can review
// reports" policy existed but was unreachable and ALL moderation silently
// failed. The grant is now restored, and this check fails if it is ever
// removed again without an admin-scoped replacement.
check(
  "15. report moderation is actually reachable (0010 revoked UPDATE and never re-granted it)",
  sql0010.includes("revoke update, delete on table public.request_reports from authenticated") &&
  sql0014.includes(
    "grant update (status, reviewed_at) on table public.request_reports to authenticated"
  ) &&
  sql0014.includes("revoke delete on table public.request_reports from authenticated"),
  true
);
check(
  "15. moderation stays admin-only: role from the DB profile, never a form field",
  srcAdminActions.includes('session.profile.role !== "admin"') &&
  srcAdminActions.includes("export async function reviewReport") &&
  !srcAdminActions.includes('formData.get("role")') &&
  srcAdminReports.includes('await requireRolePage("admin")'),
  true
);
check(
  "15. a user can only ever read or change their OWN reports",
  sql0010.includes("using (reporter_id = auth.uid())") &&
  srcAdminActions.includes('.eq("reporter_id", session.user.id)') &&
  !srcAdminActions.includes(".delete()"),
  true
);

// Reporting must never touch the request lifecycle. This is the single most
// important requester-protection invariant: a report is a moderation record,
// NOT a punishment, and must not cancel, hide, or edit a blood request.
check(
  "15. reporting never alters the request lifecycle (no blood_requests write on the report path)",
  !/update\s+public\.blood_requests/i.test(sql0014) &&
  !srcAdminActions.includes('from("blood_requests")') &&
  !srcReportForm.includes('from("blood_requests")') &&
  !srcAdminReports.includes('from("blood_requests").update'),
  true
);
check(
  "15. report lifecycle is separate: only the report's own status may change",
  sql0014.includes("request_reports_status_check") &&
  sql0014.includes("'under_review'") &&
  srcAdminActions.includes('REVIEW_ACTIONS = ["under_review", "reviewed", "dismissed"]') &&
  srcAdminActions.includes(".update({ status: action })"),
  true
);
check(
  "15. duplicate reports are blocked by a database constraint, not hidden in the UI",
  sql0010.includes("constraint request_reports_unique unique (request_id, reporter_id)") &&
  srcAdminActions.includes("UNIQUE_VIOLATION") &&
  srcAdminActions.includes("You have already reported this request"),
  true
);
check(
  "15. the controlled reason set matches TS <-> SQL, legacy values still valid",
  [
    "fake",
    "incorrect_information",
    "no_longer_needed",
    "abuse_misuse",
    "other",
  ].every((r) => sql0014.includes(`'${r}'`)) &&
  srcTypes.includes('"incorrect_information"') &&
  srcTypes.includes('"no_longer_needed"') &&
  // legacy values must NOT be dropped or historical reports break
  sql0014.includes("'spam'") &&
  sql0014.includes("'harassment'"),
  true
);

// Limits must be centralised and configurable, not magic numbers in triggers.
check(
  "15. every anti-abuse limit lives in one configurable row, not a trigger literal",
  sql0014.includes("create table if not exists public.platform_safety_limits") &&
  [
    "max_active_requests_per_requester",
    "min_request_interval_seconds",
    "max_requests_per_hour",
    "max_reports_per_day",
    "max_alert_responses_per_minute",
  ].every((c) => sql0014.includes(c)) &&
  srcSafetyForm.includes("updateSafetyLimits") &&
  sql0014.includes('"Admins can update safety limits"'),
  true
);
// The guards must be reachable from the database (not just the UI) and must
// never refuse a non-user write or a genuine emergency by default.
check(
  "15. abuse guards are database-enforced, generous, and skip non-user writes",
  sql0014.includes("before insert on public.blood_requests") &&
  sql0014.includes("before insert on public.request_reports") &&
  sql0014.includes("before update of response on public.donor_alerts") &&
  (sql0014.match(/if auth\.uid\(\) is null then\s*\n\s*return new;/g) ?? []).length >= 3 &&
  // fail open if the limits row is missing: abuse protection must never be
  // the reason a real emergency is refused
  (sql0014.match(/if not found then\s*\n\s*return new;/g) ?? []).length >= 3 &&
  sql0014.includes("errcode = 'RS001'"),
  true
);
check(
  "15. a limit is reported honestly instead of a generic failure",
  srcSafety.includes("isSafetyLimitError") &&
  srcSafety.includes("safetyLimitMessage") &&
  srcAdminActions.includes("safetyLimitMessage(dbError)") &&
  readFileSync(join(ROOT, "src/lib/actions/requests.ts"), "utf8").includes(
    "safetyLimitMessage(dbError)"
  ),
  true
);
// The report UI must be reachable, restrained, and must not out-shout the
// emergency actions it sits next to.
check(
  "15. report action is reachable from request views and never styled as an emergency",
  existsSync(join(ROOT, "src/components/requests/RequestReportForm.tsx")) &&
  readFileSync(join(ROOT, "src/app/requests/[id]/page.tsx"), "utf8").includes(
    "<RequestReportForm"
  ) &&
  srcReportForm.includes('variant="secondary"') &&
  srcReportForm.includes("required") &&
  !srcReportForm.includes('variant="danger"'),
  true
);
check(
  "15. admin moderation filters and inspects the request without a second dashboard",
  srcAdminReports.includes("requireRolePage") &&
  srcAdminReports.includes("under_review") &&
  srcAdminReports.includes("AdminReportControls") &&
  !existsSync(join(ROOT, "src/app/admin/moderation")) &&
  srcAdminReports.includes(".limit(PAGE_SIZE)"),
  true
);

// The 0014 donor-response guard is a BEFORE UPDATE OF `response` trigger. The
// engine's BULK cleanups (closure sweep, post-acceptance retire, idempotency
// safety net) must keep setting `status` only. If one of them ever also assigned
// `response`, that engine/scheduler write would start passing through the
// anti-abuse guard and could abort a real acceptance or the expiry sweep
// mid-transaction — a genuine emergency regression.
//
// The one place `response` MUST be assigned is the single-alert response write
// (`where id = p_alert_id`), which is the donor's own accept/decline. So the
// invariant is: `response` is allowed ONLY in a single-alert write.
{
  const statements = [
    ...sql0011.matchAll(
      /update\s+public\.donor_alerts\s+(?:a\s+)?set\s+([\s\S]{0,400}?)\s+where\s+([\s\S]{0,200}?);/gi
    ),
  ].map((m) => ({ set: m[1] ?? "", where: m[2] ?? "" }));
  const assignsResponse = (s: string) => /\bresponse\s*=/i.test(s);
  const isSingleAlert = (w: string) => /\bid\s*=\s*p_alert_id\b/.test(w);
  check(
    "15. only a single-alert donor response may assign `response` (the anti-abuse guard cannot abort an acceptance or sweep)",
    statements.length > 0 &&
    statements
      .filter((s) => assignsResponse(s.set))
      .every((s) => isSingleAlert(s.where)),
    true
  );
  // The guard must only ever be reachable from a genuine donor response, which
  // is what makes a generous limit harmless.
  check(
    "15. the donor-response guard is scoped to `update of response` only",
    sql0014.includes("before update of response on public.donor_alerts") &&
    sql0014.includes("if new.response is not distinct from old.response then"),
    true
  );
}

// Several of the checks below look for words like "phone", "donor_profiles",
// "accepted" or external provider names. Those words legitimately appear in the
// COMMENTS that state those things are never exposed — so a naive substring
// search would fail on the very documentation proving the property. These
// assertions therefore run against comment-stripped sources, which is also the
// only way a "this must never happen" check can be trusted.
const stripSqlComments = (s: string) => s.replace(/--[^\n]*/g, "");
const stripTsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*$/gm, "");
const sql0015Code = stripSqlComments(sql0015);
const drivesListCode = stripTsComments(srcDrivesList);
const driveDetailCode = stripTsComments(srcDriveDetail);
const rosterCode = stripTsComments(srcDriveRoster);

// --- 16. campus blood drives (prompt 26) ------------------------------------
const NDRIVE = "22222222-2222-2222-2222-222222222222";

// The single most important invariant: a campus drive is a SEPARATE planned
// workflow. Nothing in the drive path may create, edit, close or alert on a
// blood request, and the request lifecycle must stay exactly as it was.
check(
  "16. drives never touch the emergency request lifecycle, matching or alerts",
  !/insert\s+into\s+public\.blood_requests/i.test(sql0015) &&
  !/update\s+public\.blood_requests/i.test(sql0015) &&
  !/delete\s+from\s+public\.blood_requests/i.test(sql0015) &&
  !/expand_alert_rings|mark_alert_responded/.test(sql0015) &&
  !srcDrivesActions.includes("createBloodRequest") &&
  !srcDrivesActions.includes("cancelBloodRequest") &&
  !srcDrivesActions.includes("fulfillBloodRequest") &&
  !srcDrivesActions.includes('from("blood_requests")'),
  true
);
check(
  "16. a drive has its own status vocabulary and never an 'accepted' request status",
  sql0015.includes("'upcoming', 'ongoing', 'completed', 'cancelled'") &&
  !sql0015Code.includes("'accepted'") &&
  srcTypes.includes(
    'type CampusDriveStatus = "upcoming" | "ongoing" | "completed" | "cancelled"'
  ),
  true
);

// Drive donations must reuse the EXISTING ledger so the existing 0012 cooldown
// trigger fires. A parallel table would be a second eligibility system.
check(
  "16. drive donations reuse donation_history (existing cooldown, no second eligibility system)",
  sql0015.includes("add column if not exists drive_id uuid") &&
  sql0015.includes("references public.campus_blood_drives (id) on delete set null") &&
  sql0015.includes("donation_history_occasion_check") &&
  srcDrivesActions.includes('from("donation_history").insert') &&
  srcDrivesActions.includes("request_id: null") &&
  srcDrivesActions.includes("drive_id: driveId") &&
  !sql0015.includes("create table if not exists public.campus_donations"),
  true
);
// The 0010 UNIQUE(donor_id, request_id, donated_on) enforces NOTHING for a
// drive donation, because NULL never equals NULL in SQL. The partial index is
// what actually prevents a duplicate drive donation.
check(
  "16. duplicate drive donations are blocked in the database (a NULL request_id cannot dedupe itself)",
  sql0015.includes("donation_history_drive_once_uidx") &&
  sql0015.includes("on public.donation_history (donor_id, drive_id)") &&
  sql0015.includes("where drive_id is not null") &&
  srcDrivesActions.includes("UNIQUE_VIOLATION") &&
  srcDrivesActions.includes("already recorded for this donor at this drive"),
  true
);
check(
  "16. duplicate registration is impossible per (drive, donor)",
  sql0015.includes("constraint campus_drive_registrations_unique unique (drive_id, donor_id)") &&
  srcDrivesActions.includes("UNIQUE_VIOLATION") &&
  srcDrivesActions.includes("already registered for this drive"),
  true
);

// Authorization: role from the DB profile, and volunteers may check in but may
// NOT record a donation (which has a real effect on matching availability).
check(
  "16. drive permissions are role-checked server-side, with donations admin-only",
  srcDrivesActions.includes('session.profile.role !== "admin"') &&
  srcDrivesActions.includes("requireDriveCoordinator") &&
  srcDrivesActions.includes('session.profile.role !== "volunteer"') &&
  (srcDrivesActions.match(
    /export async function recordDriveDonation[\s\S]{0,400}?requireDriveAdmin\(\)/
  ) ?? []).length === 1 &&
  (srcDrivesActions.match(
    /export async function setDriveAttendance[\s\S]{0,400}?requireDriveCoordinator\(\)/
  ) ?? []).length === 1,
  true
);
check(
  "16. a donor can only ever write their own registration",
  sql0015.includes("donor_id = auth.uid()") &&
  // The donor path takes the id from the SESSION. Only the coordinator
  // (admin/volunteer check-in) path may read a donor id from the form, and
  // that action is separately gated above.
  (srcDrivesActions.match(
    /export async function registerForDrive[\s\S]{0,4000}?donor_id: session\.user\.id/
  ) ?? []).length === 1 &&
  (srcDrivesActions.match(
    /export async function registerForDrive[\s\S]{0,4000}?formData\.get\("donorId"\)/
  ) ?? []).length === 0,
  true
);

// Privacy: the public drive surface must not expose donor contact or location,
// and must never render the roster.
check(
  "16. no public drive surface reads donor contact, location or the roster",
  // What matters is what is READ, not what the copy says. Donor phone and
  // location live in donor_profiles behind their own-row RLS, so the real
  // invariant is: a public drive page never touches that table, never selects a
  // private column, and reads registrations only for the viewing donor.
  !drivesListCode.includes('from("donor_profiles")') &&
  !driveDetailCode.includes('from("donor_profiles")') &&
  // Inspect the actual .select() FIELD LISTS rather than raw source: a
  // quoted-string regex over JSX spans attributes and matches ordinary prose.
  ![
    ...drivesListCode.matchAll(/\.select\(\s*"([^"]*)"/g),
    ...driveDetailCode.matchAll(/\.select\(\s*"([^"]*)"/g),
  ]
    .map((m) => m[1] ?? "")
    .some((fields) => /\b(phone|email|latitude|longitude)\b/.test(fields)) &&
  // the registration read is always scoped to the viewing donor
  srcDriveDetail.includes('.eq("donor_id", session.user.id)') &&
  srcDonorDashboard.includes('.eq("donor_id", user.id)') &&
  srcDrivesList.includes('.eq("donor_id", session.user.id)'),
  true
);
check(
  "16. the roster shows a donor reference and state only — no private fields",
  !/donor_profiles|phone|email/.test(rosterCode) &&
  !rosterCode.includes('from("donor_profiles")') &&
  srcAdminDriveDetail.includes("AdminDriveRoster") &&
  srcAdminDriveDetail.includes("campus_drive_stats"),
  true
);
check(
  "16. aggregate stats are count-only and admin/volunteer-gated in SQL",
  sql0015.includes("create or replace function public.campus_drive_stats") &&
  sql0015.includes("count(*)::int") &&
  sql0015.includes("p.role = 'admin' or p.role = 'volunteer'") &&
  sql0015.includes("jsonb_object_agg"),
  true
);
check(
  "16. published drives are the only ones donors can read (RLS, not a UI check)",
  sql0015.includes("using (published or public.is_current_user_admin())") &&
  srcDrivesList.includes('.eq("published", true)') &&
  srcAdminDrives.includes('await requireRolePage("admin")') &&
  srcAdminDriveDetail.includes('await requireRolePage("admin")'),
  true
);
// No external notification provider, and drive notifications dedupe per drive.
check(
  "16. drive notifications are in-app only, and dedupe per (recipient, drive)",
  !/twilio|sendgrid|mailgun|smtp|whatsapp|telegram/i.test(sql0015Code) &&
  sql0015.includes("add column if not exists drive_id uuid") &&
  sql0015.includes("coalesce(new.drive_id::text, '')") &&
  sql0015.includes("n.drive_id is not distinct from new.drive_id") &&
  sql0015.includes("reminder_sent_at") &&
  srcNotifResolver.includes('"drive_registered"') &&
  srcNotifResolver.includes('"drive_upcoming_reminder"') &&
  srcNotifResolver.includes('"drive_updated"') &&
  srcNotifResolver.includes('"drive_completed"'),
  true
);
// A function revoked from `authenticated` cannot be called by RPC, so the
// application tick would fail and reminders would only ever depend on pg_cron —
// silently breaking the documented no-pg_cron fallback. 0012 sets the precedent:
// revoke, then grant execute to authenticated.
check(
  "16. the reminder sweep is executable by the app tick (revoke then grant, like 0012)",
  sql0015.includes("grant execute on function public.emit_drive_reminders(integer) to authenticated") &&
  srcDrivesActions.includes('supabase.rpc("emit_drive_reminders"') &&
  sql0012.includes(
    "grant execute on function public.emit_alert_expiring() to authenticated"
  ),
  true
);
check(
  "16. drive notifications route to the drive page, never to a request page",
  resolveNotificationDestination(notif("drive_registered", null, null, null, NDRIVE), "donor"),
  { href: `/drives/${NDRIVE}`, label: "Open drive" }
);
check(
  "16. a requester is never routed to a drive page (they are not drive recipients)",
  resolveNotificationDestination(notif("drive_updated", null, null, null, NDRIVE), "requester"),
  null
);
check(
  "16. admin gets a drives entry inside the EXISTING admin console, not a new dashboard",
  readFileSync(join(ROOT, "src/app/admin/layout.tsx"), "utf8").includes(
    'href: "/admin/drives"'
  ) && existsSync(join(ROOT, "src/app/drives/[id]/page.tsx")),
  true
);
check(
  "16. drives are integrated into the donor dashboard and notification centre",
  srcDonorDashboard.includes("<DriveCard") &&
  srcDonorDashboard.includes('href="/drives"') &&
  readFileSync(join(ROOT, "src/app/notifications/page.tsx"), "utf8").includes("drive_id"),
  true
);

// Registration transitions are server-controlled, so the permissive volunteer
// UPDATE grant cannot be used to fabricate attendance or rewrite history.
check(
  "16. registration state transitions are enforced in the database, not the UI",
  sql0015.includes("enforce_drive_registration_transition") &&
  sql0015.includes("old.status in ('participated', 'cancelled')") &&
  srcDrivesActions.includes("driveRuleMessage"),
  true
);

// The settle flag is what lets a drive actually reach a terminal state. Without
// it, completing or cancelling a drive would raise RS002 against its own
// system-driven roster update — the feature would be impossible to finish.
check(
  "16. completing/cancelling a drive can settle its own roster (no RS002 deadlock)",
  sql0015.includes("current_setting('raktsetu.drive_settle', true) = '1'") &&
  (sql0015.match(/set_config\('raktsetu\.drive_settle', '1', true\)/g) ?? []).length >= 2,
  true
);
check(
  "16. a client can never set the settle flag (transaction-local, server-set only)",
  !srcDrivesActions.includes("raktsetu.drive_settle") &&
  !srcAdminDriveDetail.includes("raktsetu.drive_settle") &&
  !srcDriveRoster.includes("raktsetu.drive_settle"),
  true
);
// Trigger ORDER inside emit_drive_completed is load-bearing. The notification
// loop filters on `status in ('registered','checked_in')`, so if anything settles
// the roster to 'participated' first, the acknowledgement loop matches nothing
// and completing a drive silently sends ZERO notifications. That is exactly
// what happened when the settle was a separate BEFORE UPDATE trigger.
{
  const completion = sql0015.slice(
    sql0015.indexOf("create or replace function public.emit_drive_completed")
  );
  const notifyAt = completion.indexOf("'drive_completed'");
  const settleAt = completion.indexOf("set status = 'participated'");
  check(
    "16. completion notifications are emitted BEFORE the roster is settled (zero-ack bug)",
    notifyAt !== -1 && settleAt !== -1 && notifyAt < settleAt,
    true
  );
  check(
    "16. no separate BEFORE trigger can pre-empt the completion acknowledgement",
    !/create trigger campus_blood_drives_settle_registrations[\s\S]{0,120}before update/.test(
      sql0015
    ) &&
    sql0015.includes("drop trigger if exists campus_blood_drives_settle_registrations") &&
    sql0015.includes("drop function if exists public.settle_drive_registrations_on_completion()"),
    true
  );
  // One status change must not produce two overlapping notices.
  check(
    "16. completing a drive does not ALSO fire the 'details changed' notice",
    sql0015.includes(
      "if new.status = 'completed' and old.status is distinct from 'completed' then\n    return null;"
    ),
    true
  );
  // Nothing may amend a recorded donation; a donation is an immutable ledger row.
  check(
    "16. no UPDATE grant is added to the donation ledger",
    !/grant update[^\n]*on table public\.donation_history/i.test(sql0015) &&
    !/grant insert[^\n]*on table public\.donation_history/i.test(sql0015),
    true
  );
  // notify_user is drop-and-recreate because adding a parameter would otherwise
  // leave two overloads and make every existing 7-argument emitter call
  // ambiguous at runtime — which would break the ring engine. The drop must
  // match the ONLY existing definition's exact signature.
  check(
    "16. notify_user is replaced, not overloaded (an ambiguous 7-arg call would break the ring engine)",
    sql0015.includes(
      "drop function if exists public.notify_user(uuid, text, text, text, uuid, bigint, text);"
    ) &&
    sql0011.includes("create or replace function public.notify_user(") &&
    sql0011.includes("p_alert_id   bigint default null") &&
    // the recreated helper must be revoked again, or it would be callable by
    // every client (a freshly created function gets DEFAULT EXECUTE to PUBLIC)
    sql0015.includes(
      "revoke all on function public.notify_user(uuid, text, text, text, uuid, bigint, text, uuid)"
    ) &&
    sql0015.includes("p_drive_id   uuid   default null"),
    true
  );
}

// --- 17. donor engagement, preferences & central settings (migration 0016) ----
// Recognition is the highest-consequence thing added here: if it ever counted
// alerts or acceptances, the platform would be lying to donors about their own
// contribution. These checks pin the authoritative source.
const sql0016Code = stripSqlComments(sql0016);
const srcPrefsForm = readFileSync(
  join(ROOT, "src/components/profile/NotificationPreferencesForm.tsx"),
  "utf8"
);
const srcSettingsForm = readFileSync(
  join(ROOT, "src/components/admin/AdminSettingsForm.tsx"),
  "utf8"
);
const srcRecognition = readFileSync(
  join(ROOT, "src/components/donor/DonorStatusBadges.tsx"),
  "utf8"
);
const recognitionBody = sql0016.slice(
  sql0016.indexOf("create or replace function public.donor_recognition")
);
check(
  "17. recognition is derived ONLY from donation_history, never from alerts or acceptances",
  recognitionBody.includes("create or replace function public.donor_recognition") &&
  recognitionBody.includes("from public.donation_history") &&
  // the function body must not touch donor_alerts at all
  !/donor_alerts/.test(recognitionBody.slice(0, recognitionBody.indexOf("$$;") + 3)) &&
  srcRecognition.includes("donor_recognition()"),
  true
);
check(
  "17. recognition is own-row and donor-only",
  sql0016.includes("grant execute on function public.donor_recognition() to authenticated") &&
  sql0016.includes("revoke all on function public.donor_recognition() from public, anon") &&
  sql0016.includes("where p.id = auth.uid() and p.role = 'donor'") &&
  // no private field may appear in the returned shape
  !/phone|latitude|longitude|locality|full_name/.test(
    sql0016.slice(
      sql0016.indexOf("returns table ("),
      sql0016.indexOf("language plpgsql")
    )
  ),
  true
);
check(
  "17. duplicate donation records cannot inflate recognition",
  sql0016.includes("donation_history_donor_day_uidx") &&
  sql0016.includes("on public.donation_history (donor_id, donated_on)") &&
  sql0015.includes("donation_history_drive_once_uidx") &&
  sql0010.includes(
    "constraint donation_history_unique unique (donor_id, request_id, donated_on)"
  ),
  true
);
check(
  "17. milestone notices dedupe per milestone (a donor can be told more than once)",
  sql0016.includes("'milestone-' || v_next::text") &&
  sql0016.includes("coalesce(new.dedupe_key, '')") &&
  sql0016.includes("n.dedupe_key is not distinct from new.dedupe_key") &&
  sql0016.includes("add column if not exists dedupe_key text"),
  true
);
check(
  "17. notification preferences are own-row only and never admin-readable",
  sql0016.includes("create table if not exists public.notification_preferences") &&
  sql0016.includes("using (user_id = auth.uid())") &&
  !/is_current_user_admin/.test(
    sql0016.slice(
      sql0016.indexOf("create table if not exists public.notification_preferences"),
      sql0016.indexOf("-- The one place the category")
    )
  ),
  true
);
check(
  "17. emergency workflow notifications are never suppressible",
  // An unmapped (null) category must always pass, and no emergency kind may be
  // mapped to a suppressible column.
  sql0016.includes("when p_kind like 'drive\\_%'") &&
  sql0016.includes("else null") &&
  sql0016.includes("v_category := public.notification_category(new.kind)") &&
  sql0016.includes("if v_category is null then") &&
  !/alert_received|donor_accepted|request_fulfilled|request_cancelled|request_expired|request_created/.test(
    sql0016.slice(
      sql0016.indexOf("create or replace function public.notification_category"),
      sql0016.indexOf(
        "$$;",
        sql0016.indexOf("create or replace function public.notification_category")
      )
    )
  ),
  true
);

check(
  "17. preferences are enforced in the database for every emitter",
  sql0016.includes("create trigger notifications_apply_preferences") &&
  sql0016.includes("before insert on public.notifications") &&
  sql0016.includes("execute function public.apply_notification_preferences()"),
  true
);
check(
  "17. the preference form offers no emergency toggle and writes the caller's own row",
  !/name="[a-z_]*(emergency|alert|accept)[a-z_]*"/i.test(srcPrefsForm) &&
  srcPrefsForm.includes("Emergency notifications cannot be turned off") &&
  srcNotifActions.includes("user_id: session.user.id") &&
  srcNotifActions.includes("NOTIFICATION_PREFERENCE_KEYS"),
  true
);
check(
  "17. reminders are one-shot, advisory, and never reference a closed request",
  sql0016.includes("cooldown_reminder_sent_for") &&
  sql0016.includes("pending_reminder_sent_at") &&
  sql0016.includes("not medical advice") &&
  sql0016.includes("blood bank always decides") &&
  // LINE-ANCHORED, not substring: a plain `includes("a.due_at > now()")` is
  // also satisfied by `a.due_at > now() - interval '100 years'`, which would
  // happily reference a long-closed request. Requiring the comparison to end
  // the line means the reminder can only ever see a live response window.
  /^\s+and a\.due_at > now\(\),?\s*$/m.test(sql0016) &&
  /^\s+and a\.pending_reminder_sent_at is null,?\s*$/m.test(sql0016) &&
  /^\s+where a\.response is null\s*$/m.test(sql0016) &&
  /^\s+and a\.status in \('sent', 'opened'\),?\s*$/m.test(sql0016) &&
  sql0016.includes("blood bank always decides"),
  true
);
check(
  "17. the donor reminder sweep is executable by the app tick (revoke then grant)",
  sql0016.includes("grant execute on function public.emit_donor_reminders() to authenticated") &&
  srcNotifActions.includes('supabase.rpc("emit_donor_reminders")'),
  true
);
check(
  "17. central settings defaults reproduce current behaviour and stay admin-only",
  sql0016.includes("max_alert_rings integer not null default 5") &&
  sql0016.includes("cooldown_reminder_lead_days integer not null default 3") &&
  sql0016.includes("donor_alert_reminder_hours integer not null default 24") &&
  sql0016.includes("drive_reminder_window_hours integer not null default 48") &&
  sql0016.includes("array[3, 7, 15]") &&
  // the gate lives in the admin LAYOUT, which wraps every /admin page
  readFileSync(join(ROOT, "src/app/admin/layout.tsx"), "utf8").includes(
    'requireRolePage("admin")'
  ),
  true
);
check(
  "17. max ring count is a REAL setting the engine honours, not a label",
  sql0016.includes("create or replace function public.alert_rings_km()") &&
  sql0016.includes("max_alert_rings from public.platform_settings") &&
  sql0016.includes("s.r[1:s.m]") &&
  // the engine reads this accessor, so clamping it here is what makes it work
  sql0011.includes("coalesce(public.alert_rings_km(), array[3, 7, 15])"),
  true
);
check(
  "17. admin settings validate every new value server-side against its bound",
  // Match on the FIELD NAME, not the whole call: the formatter wraps the
  // argument onto its own line, so a literal `readSetting("x"` never matches.
  [
    "maxAlertRings",
    "cooldownReminderLeadDays",
    "donorAlertReminderHours",
    "driveReminderWindowHours",
  ].every((field) => new RegExp(`readSetting\\(\\s*"${field}"`).test(srcAdminActions)) &&
  srcAdminActions.includes("maxRings > rings.length") &&
  srcSettingsForm.includes("maxAlertRings") &&
  srcSettingsForm.includes("driveReminderWindowHours"),
  true
);
check(
  "17. no external provider, no new request status, no request-lifecycle writes",
  !/twilio|sendgrid|mailgun|smtp|whatsapp|telegram/i.test(sql0016Code) &&
  !sql0016Code.includes("'accepted'") &&
  !/update\s+public\.blood_requests/i.test(sql0016) &&
  !/insert\s+into\s+public\.blood_requests/i.test(sql0016),
  true
);
check(
  "17. notify_user is replaced, not overloaded (9 args, revoke re-applied)",
  sql0016.includes(
    "drop function if exists public.notify_user(uuid, text, text, text, uuid, bigint, text, uuid);"
  ) &&
  sql0016.includes("p_dedupe_key text   default null") &&
  sql0016.includes(
    "revoke all on function public.notify_user(uuid, text, text, text, uuid, bigint, text, uuid, text)"
  ),
  true
);



// --- 18. hardening fixes found by the Prompt 28 integration audit ------------
// Two real defects found by tracing the flows end to end. Both are pinned here
// AND negative-tested: re-injecting the original broken state must fail them.
check(
  "18. fulfilling a request requires a real accepted donor (DB-enforced)",
  sql0017.includes("create or replace function public.guard_request_fulfilment()") &&
  sql0017.includes("create trigger blood_requests_guard_fulfilment") &&
  sql0017.includes("before update of status on public.blood_requests") &&
  // the test reads the donor-alert relationship, NOT request.status
  sql0017.includes("and a.response = 'accepted'") &&
  // only active -> fulfilled is guarded: cancellation and expiry must never
  // be blocked, or a requester could be trapped or alerts could continue
  sql0017.includes(
    "if new.status <> 'fulfilled' or old.status = 'fulfilled' then"
  ) &&
  // a trigger function is not directly callable
  sql0017.includes(
    "revoke all on function public.guard_request_fulfilment() from public, anon, authenticated"
  ),
  true
);
check(
  "18. the fulfilment guard adds no status and no competing lifecycle",
  // 'accepted' must appear in 0017's EXECUTABLE SQL only as an alert response.
  // Comments are stripped first: the migration legitimately *documents* that
  // there is no 'accepted' request status, and prose must not fail this check.
  // Delete the one legitimate use, then assert no other occurrence survives
  // anywhere — so 0017 can neither introduce nor merely READ an 'accepted'
  // REQUEST status. A regex for `new.status := 'accepted'` alone is not enough:
  // a competing lifecycle could equally READ new.status = 'accepted'.
  !stripSqlComments(sql0017)
    .replace("and a.response = 'accepted'", "")
    .includes("'accepted'") &&
  !/add column[^;]*status/i.test(sql0017) &&
  !/alter table public\.blood_requests/i.test(sql0017) &&
  sql0004.includes("check (status in ('active', 'fulfilled', 'expired', 'cancelled'))"),
  true
);
check(
  "18. the RS003 message reaches the requester instead of a generic error",
  srcRequestActionModule.includes('dbError.code === "RS003"') &&
  srcRequestActionModule.includes("return { ok: false, error: dbError.message };") &&
  sql0017.includes("errcode = 'RS003'"),
  true
);
check(
  "18. a user can always save their own notification preferences (no lockout)",
  // Row auto-created on profile insert...
  sql0017.includes("create trigger profiles_create_notification_preferences") &&
  sql0017.includes("after insert on public.profiles") &&
  sql0017.includes("insert into public.notification_preferences (user_id)") &&
  // ...plus an own-row INSERT policy as the backstop, so the action's upsert
  // can never permanently fail for a user whose row is missing.
  sql0017.includes(
    'create policy "Users can create own notification preferences"'
  ) &&
  sql0017.includes("with check (user_id = auth.uid());") &&
  sql0017.includes(
    "grant insert (user_id, drive_updates, donor_reminders, recognition_updates)"
  ) &&
  srcNotifActions.includes('.from("notification_preferences")') &&
  srcNotifActions.includes(".upsert("),
  true
);
check(
  "18. the preferences backstop still cannot touch another user's row",
  // 0016 keeps INSERT/DELETE revoked; 0017 re-grants ONLY insert (column-limited)
  // behind an own-row policy. DELETE stays revoked, and the auto-create helper
  // is never directly callable.
  sql0016.includes(
    "revoke insert, delete on table public.notification_preferences from authenticated;"
  ) &&
  sql0017.includes(
    "revoke all on function public.create_notification_preferences_row() from public, anon, authenticated"
  ) &&
  !/grant\s+delete/i.test(sql0017) &&
  sql0017.includes("for insert to authenticated\n  with check (user_id = auth.uid())"),
  true
);


// --- 19. auth hardening + mandatory glass coverage (Prompt 29) --------------
// Both are pinned here because both are easy to break silently: dropping the
// status check re-opens suspended-account access, and removing one `glass`
// class from a route fails nothing at build time but breaks the requirement.
const srcProfile = readFileSync(join(ROOT, "src/lib/profile.ts"), "utf8");
const srcRegister = readFileSync(join(ROOT, "src/components/auth/RegisterForm.tsx"), "utf8");
const srcLogin = readFileSync(join(ROOT, "src/components/auth/LoginForm.tsx"), "utf8");
const srcAuthShell = readFileSync(join(ROOT, "src/components/auth/AuthShell.tsx"), "utf8");
const srcInput = readFileSync(join(ROOT, "src/components/ui/Input.tsx"), "utf8");
const srcPassword = readFileSync(
  join(ROOT, "src/components/ui/PasswordInput.tsx"),
  "utf8"
);
const globals = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

/**
 * Strips // and block comments from TS/TSX.
 *
 * Essential here, and learned the hard way: a naive `.includes("glass")` is
 * satisfied by the WORD "glass" in a doc comment, and a naive
 * `.includes('type="button"')` is satisfied by a JSDoc sentence quoting the very
 * attribute being asserted. Comment-stripped source makes every assertion below
 * mean what it says.
 */
function stripJsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const codeProfile = stripJsComments(srcProfile);
const codeRegister = stripJsComments(srcRegister);
const codeLogin = stripJsComments(srcLogin);
const codeInput = stripJsComments(srcInput);
const codePassword = stripJsComments(srcPassword);

/**
 * True when `pattern` appears in src as an AFFIRMATIVE claim.
 *
 * RaktSetu's honest copy is full of negations — "does not guarantee blood
 * availability", "never guarantees", "no demo data" — and a naive
 * `.test(src)` flags every one of them as a violation. So this strips comments
 * first, then examines line by line, skipping any line carrying a negation.
 * A bare regex test is therefore the wrong tool for a product whose safety
 * copy is made of disclaimers.
 */
function hasAffirmative(src: string, pattern: RegExp): boolean {
  const clean = stripSqlComments(stripJsComments(src));
  const negations =
    /\b(not|never|no|nothing|without|cannot|can't|won't|does not|do not|is not|are not|nothing is|neither|nor)\b/i;
  return clean
    .split("\n")
    .some((line) => pattern.test(line) && !negations.test(line));
}

// --- Authentication ---
check(
  "19. a suspended account is blocked server-side and its session is ended",
  // BOTH guards must check status; checking only one leaves the other open.
  (codeProfile.match(/session\.profile\.status !== "active"/g) ?? []).length >= 2 &&
  srcProfile.includes("async function endSessionAndReportSuspension") &&
  // signing out is the part that actually revokes access, not just the redirect
  srcProfile.includes("await supabase.auth.signOut();") &&
  srcProfile.includes('redirect("/account-suspended")'),
  true
);
check(
  "19. public signup cannot create an admin, enforced in the DATABASE",
  // The form is defence in depth only. The real guarantee is the signup
  // trigger, which rewrites any unrecognised role — so a hand-crafted payload
  // with role=admin still lands as 'requester'.
  sql0001.includes("if v_role not in ('donor', 'requester', 'volunteer') then") &&
  sql0001.includes("v_role := 'requester';") &&
  // Tested on COMMENT-STRIPPED source: the form legitimately documents the
  // ?role=admin case in prose, and a raw scan would flag that explanation as
  // though admin were selectable in code.
  !/REGISTER_ROLES[\s\S]{0,400}admin/.test(codeRegister) &&
  codeRegister.includes("REGISTER_ROLES.some((r) => r.value === role)") &&
  // A preselected role must ALSO be filtered, or ?role=admin would preselect
  // it even though the option list does not offer it.
  codeRegister.includes("REGISTER_ROLES.some((r) => r.value === initialRole)"),
  true
);
check(
  "19. auth errors are human-readable, never raw Supabase/DB messages",
  // Every error fed to setError must route through friendlyAuthError. Asserted
  // by NEGATIVE shape: no setError argument may be a raw `.message`, a raw
  // error identifier, or a JSON dump. Matching `setError(signUpError)` exactly
  // would miss `setError(signUpError.message)` and any other raw shape.
  codeLogin.includes("friendlyAuthError") &&
  codeRegister.includes("friendlyAuthError") &&
  readFileSync(join(ROOT, "src/lib/auth-errors.ts"), "utf8").length > 0 &&
  !/setError\([^)]*\.(message|code|details)\b/.test(codeLogin + codeRegister) &&
  !/setError\(\s*(signInError|signUpError|err|error)\b/.test(
    codeLogin + codeRegister
  ),
  true
);
check(
  "19. every password field has a visible-label, non-submitting toggle",
  // Scoped to comment-stripped source: a JSDoc sentence quoting type="button"
  // must not be able to satisfy this.
  codePassword.includes("export const PasswordInput") &&
  codePassword.includes('type="button"') &&
  codePassword.includes("aria-pressed={visible}") &&
  codePassword.includes('aria-label={visible ? "Hide password" : "Show password"}') &&
  // Input/Select/Textarea must stay SERVER-safe: a "use client" on
  // Input.tsx breaks every server component rendering a plain <Input>
  // (e.g. /contact). The build catches that, but typecheck cannot.
  !/^\s*["']use client["']/m.test(srcInput) &&
  /^\s*["']use client["']/m.test(srcPassword) &&
  (codeLogin.match(/<PasswordInput/g) ?? []).length >= 1 &&
  (codeRegister.match(/<PasswordInput/g) ?? []).length >= 2,
  true
);

// --- Glassmorphism: coverage, not just definition ---
// A class defined in CSS but unused is exactly what the prompt calls out, so
// these assert the class is APPLIED in the route's own source — and matched as
// a real class token in a className/prop on COMMENT-STRIPPED source. A naive
// `.includes("glass")` is satisfied by the word "glass" in a doc comment, which
// is precisely how this check first passed while the class had been removed.
const GLASS_SURFACES: [string, string, RegExp][] = [
  ["navbar", "src/components/layout/Navbar.tsx", /className="[^"]*\bglass-bar\b/],
  ["homepage hero", "src/components/home/HeroSection.tsx", /className="[^"]*\bglass\b/],
  ["login", "src/app/login/page.tsx", /<AuthShell\b/],
  ["signup", "src/app/register/page.tsx", /<AuthShell\b/],
  ["donor dashboard", "src/components/donor/DonorStatusBadges.tsx", /<Card\s+glass\b/],
  [
    "requester / emergency request",
    "src/components/alerts/DonorAlertCard.tsx",
    /<Card\s+glass\b|className="[^"]*\bglass(-blood)?\b/,
  ],
  [
    "notifications",
    "src/components/notifications/NotificationsLive.tsx",
    /className="[^"]*\bglass(-blood)?\b/,
  ],
  ["admin dashboard", "src/app/admin/page.tsx", /className="[^"]*\bglass\b/],
  ["campus drives", "src/app/drives/page.tsx", /className="[^"]*\bglass\b/],
  ["profile / settings", "src/app/profile/page.tsx", /<Card\s+glass\b/],
];
for (const [label, file, pattern] of GLASS_SURFACES) {
  let found = false;
  try {
    found = pattern.test(stripJsComments(readFileSync(join(ROOT, file), "utf8")));
  } catch {
    found = false;
  }
  check(`19. glass applied: ${label}`, found, true);
}
check(
  "19. the auth panel is ONE reusable component, not four hand-rolled pages",
  srcAuthShell.includes("export function AuthShell") &&
  srcAuthShell.includes("glass-panel") &&
  [
    "src/app/login/page.tsx",
    "src/app/register/page.tsx",
    "src/app/forgot-password/page.tsx",
    "src/app/reset-password/page.tsx",
  ].every((f) => /<AuthShell\b/.test(stripJsComments(readFileSync(join(ROOT, f), "utf8")))),
  true
);
check(
  "19. every glass surface has a real translucent bg, blur, border and shadow",
  // All four properties, or it is not glassmorphism — a pale box is not enough.
  [".glass", ".glass-blood", ".glass-bar", ".glass-panel"].every((cls) => {
    const i = globals.indexOf(cls + " {");
    if (i === -1) return false;
    const body = globals.slice(i, globals.indexOf("}", i));
    return (
      /background-color:\s*rgba\(/.test(body) &&
      /backdrop-filter:/.test(body) &&
      /-webkit-backdrop-filter:/.test(body) &&
      // any border side counts (.glass-bar uses border-bottom, the rest border)
      /border(-[a-z]+)?:/.test(body) &&
      /box-shadow:/.test(body)
    );
  }),
  true
);
check(
  "19. glass has a no-backdrop-filter fallback and mobile blur easing",
  globals.includes("@supports not ((backdrop-filter: blur(1px))") &&
  globals.includes("@media (max-width: 639px)") &&
  globals.includes("--glass-blur: blur(8px)"),
  true
);
check(
  "19. glass is NOT applied to dense tables or long forms (readability first)",
  // RequestTable (history/admin) and the long filter form must stay opaque.
  // Comment-stripped, so the word "glass" in a doc comment cannot mask a real
  // glass class having been added.
  !/className="[^"]*\bglass(-blood|-bar|-panel)?\b/.test(
    stripJsComments(
      readFileSync(join(ROOT, "src/components/requests/RequestTable.tsx"), "utf8")
    )
  ) &&
  !/className="[^"]*\bglass(-blood|-bar|-panel)?\b/.test(
    stripJsComments(
      readFileSync(join(ROOT, "src/components/requests/RequestFilters.tsx"), "utf8")
    )
  ) &&
  !/<Card\s+glass\b/.test(
    stripJsComments(
      readFileSync(join(ROOT, "src/components/requests/RequestTable.tsx"), "utf8")
    )
  ),
  true
);

// --- 20. real-time coverage, error boundaries, deployment safety (Prompt 30) --
// Pinned because each of these fails silently: a missing live mount leaves a
// stale screen, a missing boundary leaks internals, and none of it fails a build.
const sql0018 = readFileSync(
  join(ROOT, "supabase/migrations/0018_losing_donor_notice.sql"),
  "utf8"
);
const sql0018Code = stripSqlComments(sql0018);
const routeError = readFileSync(join(ROOT, "src/app/error.tsx"), "utf8");
const globalError = readFileSync(join(ROOT, "src/app/global-error.tsx"), "utf8");
const envSrc = readFileSync(join(ROOT, "src/lib/env.ts"), "utf8");
const liveRefreshSrc = readFileSync(
  join(ROOT, "src/components/notifications/LiveRefresh.tsx"),
  "utf8"
);

// --- Real-time: every state-changing surface must have a live channel ---
// These are the pages where state can change underneath a viewer. The donor
// dashboard is the critical one: a donor must not keep pressing "I can help"
// on a request another donor already won.
const LIVE_SURFACES: [string, string][] = [
  ["requester dashboard", "src/app/dashboard/requester/page.tsx"],
  ["requester request detail", "src/app/requests/[id]/page.tsx"],
  ["donor dashboard", "src/app/dashboard/donor/page.tsx"],
  ["volunteer dashboard", "src/app/dashboard/volunteer/page.tsx"],
  ["volunteer request detail", "src/app/volunteer/requests/[id]/page.tsx"],
  ["notification centre", "src/components/notifications/NotificationsLive.tsx"],
  // One mount in the admin LAYOUT covers all eight console routes, so a
  // moderation or account-status event refreshes whichever view is open.
  ["admin console (layout, all routes)", "src/app/admin/layout.tsx"],
];
for (const [label, file] of LIVE_SURFACES) {
  let mounted = false;
  try {
    mounted = /<LiveRefresh\b/.test(
      stripJsComments(readFileSync(join(ROOT, file), "utf8"))
    );
  } catch {
    mounted = false;
  }
  check(`20. live channel mounted: ${label}`, mounted, true);
}
check(
  "20. realtime is ONE shared mechanism, and purely informational",
  // A single channel and a single notifications subscription: no parallel
  // per-role real-time systems.
  liveRefreshSrc.includes(".channel(") &&
  liveRefreshSrc.includes('table: "notifications"') &&
  // The handler only re-renders server data; it never mutates and never
  // decides an outcome, so it cannot be mistaken for authorization.
  liveRefreshSrc.includes("router.refresh()") &&
  !/signInWithPassword|updateUser|\.insert\(|\.rpc\(|fetch\("/.test(liveRefreshSrc),
  true
);
check(
  "20. the losing donor is actually told when another donor wins",
  // The kind existed in every constraint since 0012 but NOTHING emitted it.
  // Asserted on COMMENT-STRIPPED code: the migration's own header explains the
  // 'already_accepted' gap in prose, so a raw substring test would be satisfied
  // by that explanation even with the emitter deleted.
  sql0018Code.includes("'already_accepted'") &&
  sql0018.includes("execute function public.emit_already_accepted_notice()") &&
  // AFTER UPDATE: additive, cannot alter or abort the acceptance path.
  // Tested on COMMENT-STRIPPED code — the migration's own prose explains the
  // BEFORE UPDATE OF response distinction, so a raw substring test here would
  // match that explanation and pass vacuously.
  sql0018.includes("after update on public.donor_alerts") &&
  !/before\s+update/i.test(sql0018Code) &&
  // It must fire ONLY for the lost-race case, never the ordinary close-out
  // sweep — otherwise every cancel/fulfil/expiry would double-notify.
  sql0018.includes("w.response = 'accepted'") &&
  sql0018Code.includes("old.status not in ('queued', 'sent', 'opened')") &&
  sql0018.includes("if new.response is not null then"),
  true
);
check(
  "20. the losing-donor notice leaks nothing about the winning donor",
  // No identity, contact or locality of the winner may appear in the copy.
  sql0018
    .slice(sql0018.indexOf("perform public.notify_user"))
    .includes("Another donor responded first") &&
  !/donor\.full_name|donor\.phone|\.locality|\.latitude|\.longitude/.test(
    sql0018.slice(sql0018.indexOf("perform public.notify_user"))
  ),
  true
);

check(
  "20. the notice is deduped per alert (no storm, no repeats)",
  // alert_id is carried, so the 0013/0016 event-once key applies to it.
  sql0018.includes("new.id,") &&
  sql0018.includes("'/dashboard/donor'") &&
  sql0016.includes("coalesce(new.dedupe_key, '')") &&
  sql0016.includes("n.dedupe_key is not distinct from new.dedupe_key"),
  true
);
check(
  "20. the notice cannot trip the anti-abuse rate limit or the ring engine",
  // 0014 guards BEFORE UPDATE OF response. This trigger is AFTER UPDATE and
  // never assigns `response`, so it can neither trip that guard nor abort the
  // ring engine's bulk close-out sweep.
  sql0018Code.includes("after update on public.donor_alerts") &&
  !/set\s+response|new\.response\s*:=/.test(sql0018Code) &&
  // every path returns NULL, so the sweep can never be aborted by this.
  !/raise\s+exception/.test(sql0018Code),
  true
);
check(
  "20. an error boundary exists and reveals nothing technical",
  routeError.includes('"use client"') &&
  routeError.includes("reset") &&
  // error.message must never be rendered — only logged.
  !/\{error\.message\}/.test(routeError) &&
  !/error\.stack/.test(routeError) &&
  !/digest[^\n]*\}>/.test(routeError),
  true
);
check(
  "20. a global-error boundary exists, is self-contained, and leaks nothing",
  globalError.includes('"use client"') &&
  globalError.includes('<html lang="en">') &&
  // The root layout may be gone, so it must not import project components.
  !/^import\s/m.test(globalError) &&
  !/\{error\.message\}/.test(globalError) &&
  !/error\.stack/.test(globalError),
  true
);
/** Recursively lists every .ts/.tsx file under a directory. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

check(
  "20. no credential of any kind is read, embedded or exposed",
  // Stronger than the previous "no service-role key" check: with no backend at
  // all there is no environment variable to read, so ANY credential-shaped
  // reference in shared code is now a defect.
  !/SERVICE_ROLE|service_role|SUPABASE_ANON|SUPABASE_URL|CRON_SECRET/i.test(
    envSrc + liveRefreshSrc
  ) &&
    !/process\.env\./.test(envSrc) &&
    !/NEXT_PUBLIC_[A-Z0-9_]+\s*=/.test(envSrc),
  true
);
check(
  "20. the not-configured blocker can never come back",
  // This is the exact failure that shipped: every auth screen rendering
  // "Authentication is not configured" on a deployment without credentials.
  !existsSync(join(ROOT, "src/components/auth/AuthNotConfigured.tsx")) &&
    !/Authentication is not configured|is not configured yet/i.test(
      // Scoped to src/ on purpose: the checkers themselves quote the phrase
      // when asserting it is absent, and matching their own source would make
      // this check unsatisfiable.
      walk(join(ROOT, "src"))
        .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
        .map((f) => stripJsComments(readFileSync(f, "utf8")))
        .join("\n")
    ),
  true
);
check(
  "20. the data layer has no Supabase dependency left",
  // The packages were removed from package.json; an import surviving in source
  // would break the build for anyone who installs fresh.
  walk(join(ROOT, "src"))
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .every((f) => !readFileSync(f, "utf8").includes("@supabase")),
  true
);
check(
  "20. the local data layer is the single source of truth",
  // Both client entry points must resolve to the local adapter, or some pages
  // would still be waiting on a backend that no longer exists.
  readFileSync(join(ROOT, "src/lib/supabase/client.ts"), "utf8").includes(
    "createLocalClient"
  ) &&
    readFileSync(join(ROOT, "src/lib/supabase/server.ts"), "utf8").includes(
      "createLocalClient"
    ) &&
    existsSync(join(ROOT, "src/lib/local/store.ts")) &&
    existsSync(join(ROOT, "src/lib/local/engine.ts")) &&
    existsSync(join(ROOT, "src/lib/local/adapter.ts")),
  true
);
check(
  "20. realtime is only ever an optimisation, never the source of truth",
  // Mutating actions must not accept an authoritative state from the client.
  !/trustClient|skipServerCheck|fromClientState/.test(
    readFileSync(join(ROOT, "src/lib/actions/alerts.ts"), "utf8") +
    readFileSync(join(ROOT, "src/lib/actions/requests.ts"), "utf8")
  ) &&
  // The acceptance path must still re-derive the winner server-side.
  sql0011.includes("return 'already_taken';") &&
  sql0011.includes("if v_alert.status not in ('sent', 'opened') then"),
  true
);


// --- 21. presentation integrity (Prompt 31) ----------------------------------
// A presentation pass is exactly where fabricated claims sneak in, so the
// highest-value checks here are the negative ones: no medical/availability
// guarantee in copy, and no invented metric.
const homePage = readFileSync(join(ROOT, "src/app/page.tsx"), "utf8");
const constants = readFileSync(join(ROOT, "src/lib/constants.ts"), "utf8");
const registerPage = readFileSync(join(ROOT, "src/app/register/page.tsx"), "utf8");
const codeRegisterPage = stripJsComments(registerPage);
const adminPage = readFileSync(join(ROOT, "src/app/admin/page.tsx"), "utf8");
const HOME_SECTIONS = [
  "HeroSection",
  "HowItWorksSection",
  "EmergencyAlertSection",
  "TrustSection",
  "DonorSection",
  "RequesterSection",
  "VolunteerSection",
  "CampusDrivesSection",
  "EmergencyCtaSection",
];

check(
  "21. every homepage section named in the brief is actually mounted",
  // `<HeroSection appName={APP_NAME} />` carries a prop, so the pattern matches
  // the tag name rather than requiring a bare self-closing element.
  HOME_SECTIONS.every((s) => new RegExp(`<${s}\\b`).test(homePage)),
  true
);
check(
  "21. no medical-guarantee or availability claim in public copy",
  // The brief bans these outright. Scanned across ALL public-facing files, not
  // just the homepage. Negation-aware: RaktSetu's own safety copy says "does
  // not guarantee blood availability", and a naive scan would flag that
  // disclaimer as the very violation it exists to prevent.
  ![
    "src/components/home/HeroSection.tsx",
    "src/components/home/HowItWorksSection.tsx",
    "src/components/home/EmergencyAlertSection.tsx",
    "src/components/home/TrustSection.tsx",
    "src/components/home/DonorSection.tsx",
    "src/components/home/RequesterSection.tsx",
    "src/components/home/VolunteerSection.tsx",
    "src/components/home/CampusDrivesSection.tsx",
    "src/components/home/EmergencyCtaSection.tsx",
    "src/app/about/page.tsx",
    "src/lib/constants.ts",
  ].some((f) =>
    hasAffirmative(
      readFileSync(join(ROOT, f), "utf8"),
      /guarantee[ds]?\s+(blood|availability|a\s+response)|instant\s+blood|guaranteed\s+(blood|response|availability)|saving\s+every\s+life|replaces?\s+(hospitals?|blood\s+banks?)|100%\s+(safe|match|available)|always\s+available/i
    )
  ),
  true
);
check(
  "21. metadata states what the product is and promises nothing",
  constants.includes(
    'APP_TAGLINE = "Real-Time Blood Donation Coordination Platform"'
  ) &&
  // The description must carry the limits, not just the pitch.
  /does not screen donors/i.test(constants) &&
  // Negation-aware: "does not ... guarantee blood availability" is REQUIRED
  // copy, so a bare /guarantee/ test would reject the correct description.
  !hasAffirmative(constants, /guarantee/i),
  true
);
check(
  "21. no fabricated contact details, orgs or partners",
  // Inventing a phone number, support email or hospital partner is explicitly
  // banned. Obvious placeholders are NOT fabrications: a disabled form field
  // carrying you@example.com is an honest "not configured yet", not a contact.
  (() => {
    const contact = readFileSync(join(ROOT, "src/app/contact/page.tsx"), "utf8");
    return (
      !/\+\d[\d\s-]{7,}/.test(contact) &&
      !/@(?!(example|test|your)\b)[a-z0-9-]+\.(com|org|net|in)\b/i.test(contact)
    );
  })(),
  true
);
check(
  "21. a fresh database is presented honestly, not faked",
  // An all-zero dashboard must EXPLAIN itself and must not invent a number.
  // Asserted on the JSX USE, not merely that the identifier exists: defining
  // `isPlatformEmpty` and then rendering `{false && ...}` would satisfy a naive
  // `includes()` while silently disabling the empty state entirely.
  adminPage.includes("No activity yet") &&
  /\{\s*isPlatformEmpty\s*&&/.test(adminPage) &&
  !hasAffirmative(adminPage, /demo\s+data|sample\s+data|placeholder\s+data|fake\s+data/i),
  true
);
check(
  "21. role-specific signup links actually preselect the role",
  // A ?role= link that the page ignores is a dead link: it implies a choice
  // the user then has to make again.
  homePage.length > 0 &&
  /href="\/register\?role=requester"/.test(
    readFileSync(join(ROOT, "src/components/home/RequesterSection.tsx"), "utf8")
  ) &&
  /href="\/register\?role=volunteer"/.test(
    readFileSync(join(ROOT, "src/components/home/VolunteerSection.tsx"), "utf8")
  ) &&
  codeRegisterPage.includes("await searchParams") &&
  // The form must be RENDERED with the prop, not merely reference it. A
  // leftover helper that still passes initialRole while the live tree renders
  // a bare <RegisterForm /> would leave the ?role= link dead again.
  /<RegisterForm\s+initialRole=\{\s*role\s*\}/.test(codeRegisterPage) &&
  // and the preselection is filtered, so ?role=admin cannot preselect admin
  codeRegister.includes("REGISTER_ROLES.some((r) => r.value === initialRole)"),
  true
);
check(
  "21. every homepage link points at a route that exists",
  HOME_SECTIONS.every((s) => {
    const f = join(ROOT, `src/components/home/${s}.tsx`);
    if (!existsSync(f)) return false;
    const hrefs = [...readFileSync(f, "utf8").matchAll(/href="(\/[^"#]*)"/g)].map(
      (m) => m[1]
    );
    return hrefs.every((h) => {
      const path = h.split("?")[0].split("#")[0];
      if (path === "/") return existsSync(join(ROOT, "src/app/page.tsx"));
      const target = join(ROOT, "src/app", path, "page.tsx");
      return existsSync(target);
    });
  }),
  true
);
check(
  "21. no vague action labels on public CTAs",
  // "Proceed"/"Continue"/"Manage"/"Action" only read as vague out of context.
  !HOME_SECTIONS.some((s) =>
    new RegExp(
      `>\\s*(Proceed|Continue|Manage|Action|Process|Submit|Go)\\s*<`
    ).test(readFileSync(join(ROOT, `src/components/home/${s}.tsx`), "utf8"))
  ),
  true
);


// --- 22. background jobs, scheduler security & observability (Prompt 32) -----
const cronRoute = readFileSync(join(ROOT, "src/app/api/cron/tick/route.ts"), "utf8");
const sql0011Code = stripSqlComments(sql0011);
// Comment-stripped from the outset. This route's JSDoc deliberately NAMES the
// things it must not leak ("phone numbers", "service-role") and references
// expand_alert_rings() while explaining the design — so any assertion run
// against the raw file matches its own documentation instead of its code.
const cronCode = stripJsComments(cronRoute);
const ringEngine = readFileSync(join(ROOT, "src/lib/ring-engine.ts"), "utf8");
const rootLayout = readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8");

check(
  "22. the scheduler endpoint FAILS CLOSED when no secret is configured",
  // The dangerous variant is "allow when CRON_SECRET is unset". That turns a
  // missing env var into a publicly callable engine, so the guard must be an
  // explicit 503 that runs nothing.
  /if\s*\(\s*!secret\s*\)/.test(cronCode) &&
  /status:\s*503/.test(cronCode) &&
  cronCode.indexOf("if (!secret)") < cronCode.indexOf("expand_alert_rings"),
  true
);
check(
  "22. the scheduler secret is compared in constant time, and checked before any DB work",
  // Assert the COMPARISON is constant-time, not merely that the symbol appears.
  // `includes("timingSafeEqual")` is satisfied by the import and by the
  // length-mismatch branch, so swapping the real comparison for `a === b`
  // would still pass — exactly the regression worth catching.
  /return\s+timingSafeEqual\(\s*a\s*,\s*b\s*\)/.test(cronCode) &&
  // Whitespace-tolerant: prettier wraps the call as
  // `supabase.rpc(\n  "expand_alert_rings",\n)`, so an exact single-line
  // literal search silently finds nothing and the check would pass vacuously.
  /supabase\.rpc\(\s*"expand_alert_rings"/.test(cronCode) &&
  // the auth decision must precede the first RPC call
  cronCode.indexOf("secretMatches(provided, secret)") <
  cronCode.search(/supabase\.rpc\(\s*"expand_alert_rings"/),
  true
);
check(
  "22. the scheduler never returns or logs PII or raw errors",
  // Error text from Supabase can contain a project URL or a query fragment, so
  // it is logged but the response body stays generic.
  !/error:\s*ringError\.message|error:\s*expiringError\.message/.test(cronCode) &&
  !/(phone|email|latitude|longitude|locality)/i.test(cronCode) &&
  /error:\s*"Ring expansion failed"/.test(cronCode),
  true
);
check(
  "22. the scheduler introduces NO new database privilege",
  // It may only call functions already reachable by this role. A new grant here
  // would quietly widen the blast radius of a public endpoint.
  /supabase\.rpc\(\s*"expand_alert_rings"/.test(cronCode) &&
  /supabase\.rpc\(\s*"emit_alert_expiring"/.test(cronCode) &&
  sql0011.includes(
    "grant execute on function public.expand_alert_rings() to authenticated"
  ) &&
  // and no service-role key may be introduced by this feature
  !/createServiceRole|service_role|SUPABASE_SERVICE_ROLE/i.test(cronCode),
  true
);
check(
  "22. expiry is NOT duplicated: the engine already runs it",
  // Calling expire_stale_requests() again from the scheduler would be a second
  // path to authoritative lifecycle logic, which this prompt forbids.
  !/rpc\(\s*["']expire_stale_requests/.test(cronRoute) &&
  // 0011 runs it as the engine's first step
  sql0011.includes("perform public.expire_stale_requests();"),
  true
);
check(
  "22. pg_cron remains the primary, database-side scheduler",
  // The brief says integrate with an existing scheduler, not duplicate it. All
  // five time-dependent workflows must still be installed as pg_cron jobs.
  [
    ["0011", "raktsetu-alert-rings", "public.expand_alert_rings()"],
    ["0012", "raktsetu-alert-expiring", "public.emit_alert_expiring()"],
    ["0013", "raktsetu-notifications-prune", "public.prune_read_notifications(90, 500)"],
    ["0015", "raktsetu-drive-reminders", "public.emit_drive_reminders(48)"],
    ["0016", "raktsetu-donor-reminders", "public.emit_donor_reminders()"],
  ].every(([prefix, job, sql]) => {
    const files = readdirSync(join(ROOT, "supabase/migrations"));
    const f = files.find((x) => x.startsWith(prefix));
    if (!f) return false;
    const body = readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
    return body.includes(job) && body.includes(sql);
  }),
  true
);
check(
  "22. ring progression is server-side only, never driven by the browser",
  // A client timer advancing an emergency ring would be a correctness and
  // trust failure: the browser cannot be authoritative about urgency.
  !/setInterval|setTimeout/.test(ringEngine) &&
  ringEngine.includes('supabase.rpc("expand_alert_rings")') &&
  // the fallback is mounted for authenticated server renders only
  rootLayout.includes("if (user)") &&
  rootLayout.includes("await tickAlertRings()"),
  true
);
check(
  "22. ring settings come from platform settings, not hard-coded in the engine",
  sql0011.includes("coalesce(public.alert_rings_km(), array[3, 7, 15])") &&
  sql0011.includes("public.alert_window_minutes()") &&
  sql0011.includes("public.alert_due_at_offset_minutes()") &&
  // and the defaults still match the documented 3 / 7 / 15 and 10 minutes
  sql0011.includes("greatest(coalesce(public.alert_window_minutes(), 10), 1)"),
  true
);
check(
  "22. concurrent or repeated runs cannot duplicate alerts or double-advance",
  // Row-level skipping so two schedulers never process the same request, and a
  // conflict-guarded insert so a retried run can never create a second alert
  // for the same donor+request. Asserted on the real clause text, qualified by
  // its conflict target — the engine uses
  // `on conflict (request_id, donor_id) do nothing`, not a bare `on conflict`.
  sql0011.includes("for update skip locked") &&
  sql0011.includes("on conflict (request_id, donor_id) do nothing") &&
  // ring progress itself is keyed per request+ring, so it cannot double-advance
  sql0011.includes("on conflict (request_id, ring_index) do nothing"),
  true
);
check(
  "22. a stale run can never reopen or reactivate a closed request",
  // The engine must only ever SELECT active requests to expand, and must only
  // move ring progress to a finished state for non-active ones.
  /where\s+r\.status\s*=\s*'active'/.test(sql0011) &&
  sql0011.includes("and exists (") &&
  // no UPDATE of blood_requests.status inside the engine
  !/update\s+public\.blood_requests\s+set\s+status\s*=\s*'active'/i.test(sql0011),
  true
);
check(
  "22. no 'accepted' request status was introduced",
  // Careful: 'accepted' is a legitimate donor_alerts RESPONSE value — that is
  // exactly how acceptance is represented. The ban is on it becoming a
  // blood_requests STATUS, so this targets the request lifecycle specifically
  // rather than the string appearing anywhere in the engine.
  !/blood_requests[\s\S]{0,200}status\s*=\s*'accepted'/i.test(sql0011) &&
  !/update\s+public\.blood_requests[\s\S]{0,200}'accepted'/i.test(sql0011) &&
  // 'accepted' must STILL exist as an alert response — that is the sanctioned
  // representation of donor acceptance and must not be removed.
  sql0011.includes("response = 'accepted'") &&
  // The authoritative constraint must still be the four-state lifecycle.
  // Order-independent: asserting an exact literal breaks on a harmless
  // re-ordering, and the guessed order was already wrong once.
  (() => {
    const line = sql0004
      .split("\n")
      .find((l) => /status in \(/.test(l) && /fulfilled/.test(l));
    if (!line) return false;
    return (
      ["active", "fulfilled", "cancelled", "expired"].every((s) =>
        line.includes(`'${s}'`)
      ) && !line.includes("'accepted'")
    );
  })(),
  true
);


if (failures.length > 0) {

  console.error(`
¸u2717 ${failures.length} ring check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(`
${pass} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`✓ all ${pass} ring checks passed`);
