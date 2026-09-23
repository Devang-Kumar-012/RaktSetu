/**
 * Pure emergency alert-ring engine — the testable mirror of the database
 * engine in supabase/migrations/0011_emergency_alert_rings.sql.
 *
 * The DATABASE is the production executor: expand_alert_rings() (pg_cron +
 * opportunistic server tick) advances rings, and mark_alert_responded()
 * records responses atomically. This module encodes the SAME decision rules
 * in pure functions so they can be verified offline with a fake clock
 * (scripts/check-rings.ts) — the TS↔SQL mirror pattern already used by
 * scripts/check-rules.ts for blood compatibility.
 *
 * Configuration has exactly one home per side:
 *   TypeScript → src/lib/constants.ts (ALERT_RINGS_KM / ALERT_WINDOW_MINUTES
 *                / ALERT_DUE_AT_OFFSET_MINUTES)
 *   SQL        → platform_settings via alert_rings_km() /
 *                alert_window_minutes() / alert_due_at_offset_minutes()
 * check-rings.ts asserts the two defaults agree.
 *
 * Nothing here touches the network, the system clock (every entry point
 * takes `now` explicitly), or medical eligibility decisions — coordination
 * only.
 */
import { isBloodCompatible } from "@/lib/blood-compat";
import {
  ALERT_DUE_AT_OFFSET_MINUTES,
  ALERT_RINGS_KM,
  ALERT_WINDOW_MINUTES,
} from "@/lib/constants";
import { getDonorEligibility } from "@/lib/eligibility";
import { haversineKm } from "@/lib/geo";

export const MINUTE_MS = 60_000;

export interface RingConfig {
  /** Ring distances in km, expanded outward in array order. */
  ringsKm: readonly number[];
  /** Minutes each ring runs before the next one opens. */
  windowMinutes: number;
  /** Minutes before the deadline that alerts ask donors to respond by. */
  dueAtOffsetMinutes: number;
}

/** Application defaults, from the single TypeScript configuration home. */
export function defaultRingConfig(): RingConfig {
  return {
    ringsKm: ALERT_RINGS_KM,
    windowMinutes: ALERT_WINDOW_MINUTES,
    dueAtOffsetMinutes: ALERT_DUE_AT_OFFSET_MINUTES,
  };
}

export type RequestLifecycle = "active" | "fulfilled" | "expired" | "cancelled";
export type AlertStatus = "queued" | "sent" | "opened" | "responded" | "expired";
export type AlertResponse = "accepted" | "declined";
/** Why the ring process stopped — mirrors request_ring_progress.outcome. */
export type RingOutcome = "accepted" | "request_closed" | "rings_exhausted";

export interface RingProgressState {
  ringIndex: number;
  ringKm: number;
  /** Epoch ms when this ring started. */
  startedAt: number;
  /** Epoch ms when the process stopped; null while rings still run. */
  finishedAt: number | null;
  outcome: RingOutcome | null;
}

export interface AlertState {
  id: number;
  requestId: string;
  donorId: string;
  ringKm: number;
  status: AlertStatus;
  /** Epoch ms — the alert is valid strictly before this instant. */
  dueAt: number;
  response: AlertResponse | null;
}

export interface RequestEngineState {
  id: string;
  status: RequestLifecycle;
  /** Epoch ms deadline (blood_requests.required_by). */
  requiredBy: number;
  hospitalLat: number | null;
  hospitalLng: number | null;
  bloodGroup: string;
  component: "whole_blood" | "platelets";
  progress: RingProgressState[];
  alerts: AlertState[];
}

export type RingPlan =
  | { kind: "start-ring"; ringIndex: number; ringKm: number }
  | { kind: "wait" }
  | { kind: "finish"; outcome: RingOutcome };
/**
 * One scheduler tick's decision for one request — the exact decision
 * expand_alert_rings() makes inside its per-request loop, in order:
 *   closed/deadlined request → stop; accepted donor → stop; no ring yet →
 *   start ring 1; window still open → wait; final ring elapsed → stop
 *   (rings exhausted); otherwise → start the next ring.
 * Idempotent by construction: a started ring makes the next call "wait", and
 * a finished process keeps returning the same "finish".
 */
export function planRingTick(
  state: RequestEngineState,
  nowMs: number,
  config: RingConfig = defaultRingConfig()
): RingPlan {
  const current =
    [...state.progress].sort((a, b) => b.ringIndex - a.ringIndex)[0] ?? null;

  if (state.status !== "active" || state.requiredBy <= nowMs) {
    return { kind: "finish", outcome: "request_closed" };
  }
  if (state.alerts.some((a) => a.response === "accepted")) {
    return { kind: "finish", outcome: "accepted" };
  }
  if (config.ringsKm.length === 0) {
    return { kind: "finish", outcome: "rings_exhausted" };
  }
  if (current === null) {
    return { kind: "start-ring", ringIndex: 1, ringKm: config.ringsKm[0] };
  }
  if (current.finishedAt !== null) {
    return { kind: "finish", outcome: current.outcome ?? "rings_exhausted" };
  }
  if (nowMs < current.startedAt + config.windowMinutes * MINUTE_MS) {
    return { kind: "wait" };
  }
  if (current.ringIndex >= config.ringsKm.length) {
    return { kind: "finish", outcome: "rings_exhausted" };
  }
  const ringIndex = current.ringIndex + 1;
  return { kind: "start-ring", ringIndex, ringKm: config.ringsKm[ringIndex - 1] };
}

/**
 * Respond-by deadline stored on each alert: the configured offset before the
 * request deadline, clamped so an emergency already inside the offset window
 * still gets a future due_at (never later than the deadline itself).
 * Mirrors the CASE expression in expand_alert_rings() / mark_alert_responded().
 */
export function computeAlertDueAt(
  requiredByMs: number,
  nowMs: number,
  config: RingConfig = defaultRingConfig()
): number {
  const offsetDeadline = requiredByMs - config.dueAtOffsetMinutes * MINUTE_MS;
  return offsetDeadline <= nowMs ? requiredByMs : offsetDeadline;
}

/** A donor as the ring engine sees one — the fields matching rules use. */
export interface RingCandidate {
  userId: string;
  bloodGroup: string;
  availability: "available" | "temporarily_unavailable";
  /** YYYY-MM-DD of the last donation, or null. */
  lastDonationDate: string | null;
  /** Approximate coordinate; null when unknown. */
  latitude: number | null;
  longitude: number | null;
  /** Active account (default true for directory entries). */
  accountActive?: boolean;
}

export interface RingRequestShape {
  status: RequestLifecycle;
  bloodGroup: string;
  component: "whole_blood" | "platelets";
  hospitalLat: number | null;
  hospitalLng: number | null;
}

/**
 * Donors to alert for ONE ring — a fresh evaluation of every matching rule,
 * mirroring match_donors_for_request() + the engine's already-alerted filter:
 *   1. request must be active,
 *   2. never anyone already alerted for this request (UNIQUE request+donor
 *      covers declines, acceptances, and earlier rings),
 *   3. donor available AND past the donation cooldown (getDonorEligibility —
 *      same rule as donor_directory),
 *   4. active account,
 *   5. blood-group compatible for the requested component,
 *   6. inside the ring when the hospital has coordinates — a donor whose
 *      distance cannot be proven is excluded; when the hospital has no
 *      coordinates, distance is unknown and every eligible donor qualifies,
 *   7. closest first, unknown distances last, stable tie-break by userId.
 * Returns donor ids only — never contact details or coordinates.
 */
export function selectRingDonors(
  request: RingRequestShape,
  candidates: readonly RingCandidate[],
  alreadyAlerted: Iterable<string>,
  ringKm: number
): string[] {
  if (request.status !== "active") return [];
  const alerted = new Set(alreadyAlerted);
  const hasHospitalLocation =
    request.hospitalLat !== null && request.hospitalLng !== null;

  return candidates
    .filter((c) => c.accountActive !== false)
    .filter((c) => !alerted.has(c.userId))
    .filter(
      (c) =>
        getDonorEligibility({
          availability: c.availability,
          last_donation_date: c.lastDonationDate,
        }).status === "available"
    )
    .filter((c) =>
      isBloodCompatible(c.bloodGroup, request.bloodGroup, request.component)
    )
    .map((c) => ({
      c,
      dist: haversineKm(
        c.latitude,
        c.longitude,
        request.hospitalLat,
        request.hospitalLng
      ),
    }))
    .filter(({ dist }) => !hasHospitalLocation || (dist !== null && dist <= ringKm))
    .sort((a, b) => {
      if (a.dist === null && b.dist === null)
        return a.c.userId.localeCompare(b.c.userId);
      if (a.dist === null) return 1;
      if (b.dist === null) return -1;
      if (a.dist !== b.dist) return a.dist - b.dist;
      return a.c.userId.localeCompare(b.c.userId);
    })
    .map(({ c }) => c.userId);
}

// ---------------------------------------------------------------------------
// Acceptance — the pure mirror of mark_alert_responded() (migration 0011).
// ---------------------------------------------------------------------------

/** Donor state re-checked at response time (SQL: donor_directory + profiles). */
export interface EligibilityDonor {
  availability: "available" | "temporarily_unavailable";
  lastDonationDate: string | null;
  bloodGroup: string;
  accountActive?: boolean;
}

export type AcceptanceOutcome =
  | "accepted"
  | "declined"
  | "invalid_response"
  | "not_found"
  | "not_your_alert"
  | "already_responded"
  | "already_taken"
  | "request_closed"
  | "alert_expired"
  | "not_eligible";

export interface AcceptanceResult {
  outcome: AcceptanceOutcome;
  /** Post-response alert presentation — null for every non-success outcome. */
  responded: { status: AlertStatus; response: AlertResponse; respondedAt: number } | null;
  /** Winning acceptance ONLY: epoch ms until which requester contact may be
   *  shown (SQL: contact_shared_until). The engine itself never handles the
   *  contact fields — they are served exclusively by the database functions. */
  contactSharedUntil: number | null;
}

/**
 * Can this alert still be accepted or declined right now? UI gating only —
 * the database re-checks everything atomically on submit. Mirrors the SQL
 * guards: open status, due_at not passed, no response recorded yet.
 */
export function isAlertActionable(alert: AlertState, nowMs: number): boolean {
  if (alert.response !== null) return false;
  if (alert.status !== "sent" && alert.status !== "opened") return false;
  return alert.dueAt > nowMs;
}

function failure(outcome: AcceptanceOutcome): AcceptanceResult {
  return { outcome, responded: null, contactSharedUntil: null };
}

/**
 * Resolve ONE donor response — checks run in the EXACT order of
 * mark_alert_responded() so both layers return the same outcome code:
 * invalid input → not found → wrong owner → already responded → another
 * donor already won → alert not open → alert past due → request closed →
 * donor no longer eligible → declined | accepted. The first valid
 * acceptance wins; every failure result carries no contact window.
 * `nowMs` injects the clock (SQL uses now()).
 */
export function resolveAcceptance(
  request: RequestEngineState,
  alert: AlertState | null,
  donor: EligibilityDonor,
  donorId: string,
  response: AlertResponse,
  nowMs: number,
  config: RingConfig = defaultRingConfig()
): AcceptanceResult {
  if (response !== "accepted" && response !== "declined") {
    return failure("invalid_response");
  }
  if (alert === null || alert.requestId !== request.id) return failure("not_found");
  if (alert.donorId !== donorId) return failure("not_your_alert");
  if (alert.response !== null) return failure("already_responded");
  // Winner checked BEFORE validity so a late donor learns the true reason
  // (mirrors the SQL ordering exactly).
  if (request.alerts.some((a) => a.response === "accepted")) {
    return failure("already_taken");
  }
  if (alert.status !== "sent" && alert.status !== "opened") {
    return failure("request_closed");
  }
  if (alert.dueAt <= nowMs) return failure("alert_expired");
  if (request.status !== "active" || request.requiredBy <= nowMs) {
    return failure("request_closed");
  }
  const stillEligible =
    getDonorEligibility({
      availability: donor.availability,
      last_donation_date: donor.lastDonationDate,
    }).status === "available" &&
    donor.accountActive !== false &&
    isBloodCompatible(donor.bloodGroup, request.bloodGroup, request.component);
  if (!stillEligible) return failure("not_eligible");

  const responded: NonNullable<AcceptanceResult["responded"]> = {
    status: "responded",
    response,
    respondedAt: nowMs,
  };
  if (response === "declined") {
    return { outcome: "declined", responded, contactSharedUntil: null };
  }
  return {
    outcome: "accepted",
    responded,
    contactSharedUntil: computeAlertDueAt(request.requiredBy, nowMs, config),
  };
}
