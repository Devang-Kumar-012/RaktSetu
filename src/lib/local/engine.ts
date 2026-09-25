/**
 * RaktSetu local coordination engine.
 *
 * Replaces the Supabase SQL functions (matching, ring expansion, acceptance,
 * contact reveal, notifications) with deterministic TypeScript over the local
 * store, so the emergency experience works with no backend at all.
 *
 * The rules are the SAME ones the SQL enforced, deliberately:
 *   - 3 km → 7 km → 15 km, ten minutes per ring;
 *   - the ring is RECOMPUTED from stored timestamps on every read, so nothing
 *     depends on a timer or an open tab;
 *   - a donor is alerted at most once per request (not merely per ring);
 *   - acceptance is first-writer-wins and stops every future ring;
 *   - a closed request (fulfilled / cancelled / expired) is never reopened;
 *   - donor contact details are revealed ONLY after a valid acceptance.
 *
 * Ring timing is evaluated from the clock at call time rather than by a
 * background job, which is what makes it work with no scheduler.
 */

import { isBloodCompatible } from "@/lib/blood-compat";
import {
  clone,
  getPlatformSettings,
  newId,
  nowIso,
  readDatabase,
  updateDatabase,
  writeDatabase,
  type LocalBloodRequest,
  type LocalDonorAlert,
  type LocalDonorProfile,
  type LocalDatabase,
  type LocalNotification,
  type LocalRequestStatus,
  type LocalUser,
} from "./store";

/**
 * Documented defaults, matching the original SQL configuration.
 *
 * These are the FALLBACKS, not the live values: the ring engine reads the
 * platform_settings row on every tick, so an admin change takes effect
 * immediately. They are exported for the UI's explanatory copy and for rendering
 * before any settings row exists.
 */
export const RING_KM = [3, 7, 15] as const;
export const RING_WINDOW_MINUTES = 10;
export const ALERT_DUE_OFFSET_MINUTES = 120;
export const DEFAULT_COOLDOWN_DAYS = 90;

let ringKm: number[] = [...RING_KM];
let ringWindowMinutes = RING_WINDOW_MINUTES;
let alertDueOffsetMinutes = ALERT_DUE_OFFSET_MINUTES;
let cooldownDays = DEFAULT_COOLDOWN_DAYS;

/**
 * Keeps the module-level mirrors in step with the stored settings.
 *
 * Called at the top of every engine entry point so a settings change is picked
 * up on the next action without a page reload — and, critically, so a stale
 * mirror can never be used after an admin has changed a value.
 */
function refreshSettings(): void {
  const s = getPlatformSettings();
  ringKm = s.alert_rings_km;
  ringWindowMinutes = s.alert_window_minutes;
  alertDueOffsetMinutes = s.alert_due_at_offset_minutes;
  cooldownDays = s.donation_interval_days;
}

export function setCooldownDays(days: number): void {
  if (Number.isFinite(days) && days > 0) cooldownDays = days;
}
export function getCooldownDays(): number {
  return cooldownDays;
}

function donorIsEligible(
  donor: LocalDonorProfile,
  user: LocalUser | undefined,
  request: LocalBloodRequest,
  nowMs: number,
): boolean {
  if (!user || user.status !== "active" || user.role !== "donor") return false;
  if (donor.availability !== "available") return false;
  if (!isBloodCompatible(donor.blood_group, request.blood_group, request.blood_component)) {
    return false;
  }
  // Application-level interval only. Never a medical judgement.
  if (donor.last_donation_date) {
    const last = new Date(`${donor.last_donation_date}T00:00:00Z`).getTime();
    if (Number.isFinite(last) && nowMs - last < cooldownDays * 86_400_000) return false;
  }
  return true;
}

/** Great-circle distance in km; null when either point is unknown. */
export function distanceKm(
  aLat: number | null,
  aLng: number | null,
  bLat: number | null,
  bLng: number | null,
): number | null {
  if (aLat === null || aLng === null || bLat === null || bLng === null) return null;
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Marks a request's ring process finished and retires its open alerts. */
export function closeProcessForRequest(
  db: LocalDatabase,
  request: LocalBloodRequest,
  outcome: "accepted" | "request_closed" | "rings_exhausted",
): void {
  for (const p of db.ring_progress) {
    if (p.request_id === request.id && p.finished_at === null) {
      p.finished_at = nowIso();
      p.outcome = outcome;
    }
  }
  // Nothing actionable may remain on a closed request.
  for (const a of db.donor_alerts) {
    if (a.request_id === request.id && a.response === null && a.status !== "responded") {
      a.status = "expired";
      a.updated_at = nowIso();
    }
  }
}

/**
 * Creates a notification unless the same logical event already exists.
 * The dedupe key is what stops a reminder or a repeated tick storming a user.
 */
export function notify(
  db: LocalDatabase,
  userId: string,
  kind: string,
  title: string,
  body: string,
  requestId: string | null,
  alertId: string | null,
  driveId: string | null,
  dedupeKey: string | null,
  link: string | null,
): void {
  if (dedupeKey) {
    const exists = db.notifications.some(
      (n) => n.user_id === userId && n.kind === kind && n.dedupe_key === dedupeKey,
    );
    if (exists) return;
  }
  const row: LocalNotification = {
    id: db.next_notification_id++,
    user_id: userId,
    kind,
    title,
    body,
    request_id: requestId,
    alert_id: alertId,
    drive_id: driveId,
    dedupe_key: dedupeKey,
    link,
    read_at: null,
    created_at: nowIso(),
  };
  db.notifications.push(row);
}

/**
 * Expands every active request by at most one ring, then returns the number of
 * alerts created. Safe to call repeatedly from any page: each call derives the
 * current ring from stored timestamps, so a late call advances the rings it has
 * actually earned rather than replaying them.
 */
export function expandAlertRings(): number {
  refreshSettings();
  return updateDatabase((db) => {
    const now = Date.now();
    let created = 0;

    // 1. Expire anything past its deadline before anything else.
    for (const r of db.blood_requests) {
      if (r.status !== "active") continue;
      if (new Date(r.required_by).getTime() > now) continue;
      r.status = "expired";
      r.updated_at = nowIso();
      closeProcessForRequest(db, r, "request_closed");
      notify(
        db,
        r.requester_id,
        "request_expired",
        "Your blood request expired",
        `The request for ${r.units} unit(s) of ${r.blood_group} at ${r.hospital_name} passed its deadline and is now closed.`,
        r.id,
        null,
        null,
        `expired-${r.id}`,
        "/dashboard/requester",
      );
    }

    // 2. Advance rings for requests that are still active.
    for (const request of db.blood_requests) {
      if (request.status !== "active") continue;
      if (new Date(request.required_by).getTime() <= now) continue;

      // A winner stops every future ring.
      if (
        db.donor_alerts.some(
          (a) => a.request_id === request.id && a.response === "accepted",
        )
      ) {
        closeProcessForRequest(db, request, "accepted");
        continue;
      }

      const last =
        [...db.ring_progress.filter((p) => p.request_id === request.id)].sort(
          (a, b) => b.ring_index - a.ring_index,
        )[0] ?? null;

      const targetIndex = last ? Math.min(last.ring_index, ringKm.length) : 0;
      if (targetIndex >= ringKm.length) {
        closeProcessForRequest(db, request, "rings_exhausted");
        continue;
      }
      if (last) {
        const elapsedMin = (now - new Date(last.started_at).getTime()) / 60_000;
        if (elapsedMin < ringWindowMinutes) continue; // still inside the window
      }

      const ringKmValue = ringKm[targetIndex];
      // UNIQUE(request, donor): never alert the same donor twice for one
      // request, however far the search widens.
      const already = new Set(
        db.donor_alerts.filter((a) => a.request_id === request.id).map((a) => a.donor_id),
      );

      for (const profile of db.donor_profiles) {
        if (already.has(profile.user_id)) continue;
        const user = db.users.find((u) => u.id === profile.user_id);
        if (!donorIsEligible(profile, user, request, now)) continue;

        const d = distanceKm(
          request.latitude,
          request.longitude,
          profile.latitude,
          profile.longitude,
        );
        // With no coordinates the demo must still be able to show an alert, so
        // distance is treated as unknown rather than disqualifying. WITH
        // coordinates the radius is enforced strictly.
        if (d !== null && d > ringKmValue) continue;

        const alert: LocalDonorAlert = {
          id: newId("alert"),
          request_id: request.id,
          donor_id: profile.user_id,
          ring_index: targetIndex + 1,
          ring_km: ringKmValue,
          status: "sent",
          response: null,
          responded_at: null,
          accepted_at: null,
          contact_shared_until: null,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        db.donor_alerts.push(alert);
        already.add(profile.user_id);
        created += 1;

        notify(
          db,
          profile.user_id,
          "alert_received",
          `Blood needed nearby — ${request.blood_group}`,
          `${request.units} unit(s) needed at ${request.hospital_name}, ${request.hospital_locality}. This is an application-level alert; the blood bank decides medical eligibility.`,
          request.id,
          alert.id,
          null,
          `alert-${alert.id}`,
          "/dashboard/donor",
        );
      }

      const row = db.ring_progress.find(
        (p) => p.request_id === request.id && p.ring_index === targetIndex + 1,
      );
      if (row) {
        row.ring_km = ringKmValue;
      } else {
        db.ring_progress.push({
          request_id: request.id,
          ring_index: targetIndex + 1,
          ring_km: ringKmValue,
          started_at: nowIso(),
          finished_at: null,
          outcome: null,
        });
      }
    }
    return created;
  });
}


/** Outcome codes, matching the original SQL so existing UI keeps working. */
export type RespondResult =
  | "accepted"
  | "declined"
  | "already_responded"
  | "already_taken"
  | "request_closed"
  | "alert_expired"
  | "not_your_alert"
  | "not_eligible";

/**
 * Records a donor's answer to one of their own alerts.
 *
 * FIRST-VALID-ACCEPTANCE-WINS: the re-read of the alert and the check for an
 * existing winner happen inside a single synchronous store update, so two
 * "I can help" actions cannot both succeed. A loser is told the truth rather
 * than being shown a request that already has a donor.
 */
export function respondToAlert(
  alertId: string,
  donorId: string,
  response: "accepted" | "declined",
): RespondResult {
  refreshSettings();
  return updateDatabase((db) => {
    const alert = db.donor_alerts.find((a) => a.id === alertId);
    if (!alert || alert.donor_id !== donorId) return "not_your_alert";
    if (alert.response !== null) return "already_responded";

    const request = db.blood_requests.find((r) => r.id === alert.request_id);
    if (!request || request.status !== "active") return "request_closed";
    if (new Date(request.required_by).getTime() <= Date.now()) return "request_closed";
    if (alert.status !== "sent" && alert.status !== "opened") return "request_closed";

    // Someone already won?
    if (
      db.donor_alerts.some(
        (a) =>
          a.request_id === request.id &&
          a.response === "accepted" &&
          a.id !== alertId,
      )
    ) {
      return "already_taken";
    }

    const donor = db.donor_profiles.find((d) => d.user_id === donorId);
    const user = db.users.find((u) => u.id === donorId);
    if (!donor || !donorIsEligible(donor, user, request, Date.now())) {
      return "not_eligible";
    }

    alert.response = response;
    alert.responded_at = nowIso();
    alert.status = "responded";
    alert.updated_at = nowIso();

    if (response === "declined") return "declined";

    alert.accepted_at = nowIso();
    const deadline = new Date(request.required_by).getTime();
    const due = deadline - alertDueOffsetMinutes * 60_000;
    alert.contact_shared_until = new Date(Math.min(due, deadline)).toISOString();

    closeProcessForRequest(db, request, "accepted");

    // Everyone still waiting hears that someone else responded first.
    for (const other of db.donor_alerts) {
      if (other.request_id !== request.id) continue;
      if (other.id === alertId || other.response !== null) continue;
      other.status = "expired";
      other.updated_at = nowIso();
      notify(
        db,
        other.donor_id,
        "already_accepted",
        "Another donor responded first",
        "Someone else accepted the blood request you were alerted about, so your response is no longer needed. No action is required — thank you for being ready to help.",
        request.id,
        other.id,
        null,
        `already-accepted-${other.id}`,
        "/dashboard/donor",
      );
    }

    notify(
      db,
      donorId,
      "acceptance_confirmed",
      "You accepted this request",
      `Thank you — your acceptance is recorded for the ${request.blood_group} need at ${request.hospital_name}, ${request.hospital_locality}. The requester can see your name and phone until the response window closes.`,
      request.id,
      alert.id,
      null,
      `acceptance-${alert.id}`,
      "/dashboard/donor",
    );
    notify(
      db,
      request.requester_id,
      "donor_accepted",
      "A donor accepted your blood request",
      `An alerted donor responded yes for ${request.units} unit(s) of ${request.blood_group} at ${request.hospital_name}. Their contact is on your request until the deadline.`,
      request.id,
      alert.id,
      null,
      `donor-accepted-${alert.id}`,
      "/dashboard/requester",
    );
    db.audit_events.push({
      id: newId("audit"),
      actor_id: donorId,
      action: "accept_request",
      entity: "blood_request",
      entity_id: request.id,
      created_at: nowIso(),
    });
    return "accepted";
  });
}

/**
 * The requester's authorised view of the accepted donor.
 *
 * This is the ONLY path that returns donor contact details. It filters to
 * requests the caller owns AND that have a real acceptance, so contact data
 * cannot be read before a valid acceptance exists.
 */
export function revealAcceptedDonors(
  requesterId: string,
  requestIds: string[],
): unknown[] {
  const db = readDatabase();
  const mine = new Set(
    db.blood_requests.filter((r) => r.requester_id === requesterId).map((r) => r.id),
  );
  const out: unknown[] = [];
  for (const alert of db.donor_alerts) {
    if (alert.response !== "accepted") continue;
    if (!requestIds.includes(alert.request_id) || !mine.has(alert.request_id)) continue;
    const donor = db.donor_profiles.find((d) => d.user_id === alert.donor_id);
    const user = db.users.find((u) => u.id === alert.donor_id);
    if (!donor || !user) continue;
    out.push({
      request_id: alert.request_id,
      donor_name: user.full_name,
      donor_phone: donor.phone,
      locality: donor.locality,
      blood_group: donor.blood_group,
      contact_shared_until: alert.contact_shared_until,
    });
  }
  return clone(out);
}

/**
 * Records one completed donation.
 *
 * This is the ONLY path that creates a donation record, and it is the
 * authoritative source for recognition. It re-checks the acceptance inside a
 * single store update, so a donation can never be recorded against a request
 * that has no accepted donor — and the donor/day guard is what stops a repeated
 * submission from inflating recognition.
 *
 * Recording a donation is an administrative record of what the blood bank
 * already did. It asserts nothing about medical eligibility.
 */
export function recordDonation(
  donorId: string,
  requestId: string,
  units: number,
): { ok: true } | { ok: false; error: string } {
  return updateDatabase((db) => {
    const request = db.blood_requests.find((r) => r.id === requestId);
    if (!request) return { ok: false, error: "That request could not be found." };

    const accepted = db.donor_alerts.some(
      (a) => a.request_id === requestId && a.response === "accepted",
    );
    if (!accepted) {
      return {
        ok: false,
        error: "A donation can only be recorded once a donor has accepted this request.",
      };
    }

    const won = db.donor_alerts.find(
      (a) => a.request_id === requestId && a.response === "accepted",
    );
    if (won && won.donor_id !== donorId) {
      return { ok: false, error: "A different donor accepted this request." };
    }

    const donatedOn = new Date().toISOString().slice(0, 10);
    const duplicate = db.donation_history.some(
      (d) => d.donor_id === donorId && d.donated_on === donatedOn,
    );
    if (duplicate) {
      return {
        ok: false,
        error: "A donation is already recorded for this donor today.",
      };
    }

    db.donation_history.push({
      id: newId("don"),
      donor_id: donorId,
      request_id: requestId,
      drive_id: null,
      donated_on: donatedOn,
      blood_component: request.blood_component,
      units: Number.isFinite(units) && units > 0 ? Math.floor(units) : 1,
      created_at: nowIso(),
    });

    // Keep the donor's own eligibility tracking in step with the ledger.
    const profile = db.donor_profiles.find((p) => p.user_id === donorId);
    if (profile) {
      profile.last_donation_date = donatedOn;
      profile.donation_count += 1;
      profile.updated_at = nowIso();
    }

    notify(
      db,
      donorId,
      "recognition_milestone",
      "Your donation was recorded",
      "Thank you — your donation is now on your record. Recognition counts recorded donations only; medical eligibility is always decided by the blood bank.",
      null,
      null,
      null,
      `donation-${requestId}`,
      "/dashboard/donor",
    );

    db.audit_events.push({
      id: newId("audit"),
      actor_id: donorId,
      action: "record_donation",
      entity: "blood_request",
      entity_id: requestId,
      created_at: nowIso(),
    });

    return { ok: true };
  });
}

export function setRequestStatus(
  requestId: string,
  requesterId: string,
  status: Extract<LocalRequestStatus, "fulfilled" | "cancelled">,
): "ok" | "not_found" | "not_owner" | "already_closed" {
  refreshSettings();
  refreshSettings();
  return updateDatabase((db) => {
    const request = db.blood_requests.find((r) => r.id === requestId);
    if (!request) return "not_found";
    if (request.requester_id !== requesterId) return "not_owner";
    if (request.status !== "active") return "already_closed";

    request.status = status;
    request.updated_at = nowIso();
    closeProcessForRequest(db, request, "request_closed");

    notify(
      db,
      requesterId,
      `request_${status}`,
      `Your blood request was ${status}`,
      `The ${request.blood_group} request at ${request.hospital_name} is now ${status}. Alerting has stopped.`,
      request.id,
      null,
      null,
      `${status}-${request.id}`,
      "/dashboard/requester",
    );
    for (const a of db.donor_alerts) {
      if (a.request_id !== request.id || a.response !== null) continue;
      notify(
        db,
        a.donor_id,
        "request_closed",
        "A blood request you were alerted about has closed",
        `The request at ${request.hospital_name} is no longer active — no further action is needed.`,
        request.id,
        a.id,
        null,
        `closed-${request.id}-${a.donor_id}`,
        "/dashboard/donor",
      );
    }
    return "ok";
  });
}

