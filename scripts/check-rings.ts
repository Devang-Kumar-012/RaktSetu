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
 *
 * The DATABASE is the production executor (expand_alert_rings() +
 * mark_alert_responded()); src/lib/alert-rings.ts mirrors its decision rules
 * — the same TS-mirrors-SQL pattern check-rules.ts uses for compatibility.
 */
import { readFileSync } from "node:fs";
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

// --- report ----------------------------------------------------------------
if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} ring check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(`\n${pass} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`✓ all ${pass} ring checks passed`);
