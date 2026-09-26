/**
 * The blood-request workflow, executed against SQLite.
 *
 * THE SEAM. `src/lib/actions/requests.ts` and `src/lib/actions/alerts.ts`
 * already call through `createSupabaseServerClient()`; this module supplies the
 * server-authoritative behaviour those call sites need, so no page and no action
 * is rewritten. It is the persistence implementation UNDER the existing
 * application interface, which is why the function names and result codes match
 * what `src/lib/local/engine.ts` (and originally the Postgres functions)
 * already returned.
 *
 * WHY THIS FILE EXISTS RATHER THAN MORE `supabase.from(...)` CHAINING
 *
 * Three things the request workflow needs cannot be expressed as a chained
 * read/write, and each of them used to be delegated to the legacy local
 * adapter — which is `localStorage`, and therefore a silent NO-OP on a server:
 *
 *   1. A decision that must be ATOMIC. Donor acceptance is first-valid-donor-
 *      wins. Written as "has someone already accepted?" then "insert", two
 *      simultaneous responses both see an empty result and both win. Here the
 *      write happens inside one transaction and the guarantee is enforced by a
 *      partial unique index in `db.ts` — the database decides the winner, not
 *      this code and not the browser.
 *   2. A decision that must be DERIVED (eligibility, expiry, ring expansion).
 *   3. Fan-out writes (notify the losers, close the process) that must happen
 *      with the decision or not at all.
 *
 * IDENTITY IS NEVER AN ARGUMENT YOU CAN TRUST
 *
 * Every exported writer takes the caller's id from the session and re-checks
 * ownership inside the transaction. `requester_id`, `donor_id` and `user_id`
 * arriving from a request body are used ONLY to look up a row, never to decide
 * who the caller is — the same rule `sql-dashboard.ts` applies to reads.
 *
 * SERVER ONLY: opens the database file on disk.
 */

import { randomUUID } from "node:crypto";

import { getDb } from "./db";
import { isBloodCompatible } from "@/lib/blood-compat";
import { haversineKm } from "@/lib/geo";
import { ALERT_RINGS_KM } from "@/lib/constants";

type Row = Record<string, unknown>;
type Db = ReturnType<typeof getDb>;

/** The signed-in account, as resolved from the HTTP-only session cookie. */
export interface RequestCaller {
  id: string;
  role: string;
}

const nowIso = (): string => new Date().toISOString();

/** The four lifecycle states. `accepted` is deliberately NOT one of them —
 *  acceptance is a relationship between a donor and a request, not a state the
 *  request itself can be in. */
export type LifecycleStatus = "active" | "fulfilled" | "cancelled" | "expired";
/** The two states a REQUESTER may drive. Expiry is the engine's to set. */
export type RequesterClosable = Extract<LifecycleStatus, "fulfilled" | "cancelled">;

/** Outcome of a donor response, matching the codes the UI already maps. */
export type RespondOutcome =
  | "accepted"
  | "declined"
  | "not_found"
  | "not_your_alert"
  | "already_responded"
  | "already_taken"
  | "request_closed"
  | "alert_expired"
  | "not_eligible"
  | "invalid_response";

/* ------------------------------------------------------------------ helpers */

/**
 * Reads the live ring/window/cooldown configuration, falling back to the
 * documented defaults. Mirrors the local engine, so an admin's settings change
 * takes effect on the next call.
 */
function settings(): {
  rings: number[];
  windowMinutes: number;
  dueOffsetMinutes: number;
  cooldownDays: number;
  maxRings: number;
} {
  const row = getDb()
    .prepare(
      `SELECT alert_rings_km, alert_window_minutes, alert_due_at_offset_minutes,
              donation_interval_days, max_alert_rings
         FROM platform_settings WHERE id = 1`,
    )
    .get() as Row | undefined;
  const rings = String(row?.alert_rings_km ?? ALERT_RINGS_KM.join(","))
    .split(",")
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    rings: rings.length ? rings : [...ALERT_RINGS_KM],
    windowMinutes: num(row?.alert_window_minutes, 10),
    dueOffsetMinutes: num(row?.alert_due_at_offset_minutes, 120),
    cooldownDays: num(row?.donation_interval_days, 90),
    maxRings: num(row?.max_alert_rings, 5),
  };
}

/**
 * Runs `fn` inside an IMMEDIATE transaction.
 *
 * IMMEDIATE takes the write lock up front rather than upgrading mid-transaction,
 * so two concurrent acceptances serialise at BEGIN instead of failing late with
 * SQLITE_BUSY. That is what makes "re-read the current winner, then write mine"
 * safe here. Any throw rolls the whole thing back, so a partial fan-out can
 * never be observed.
 */
function transaction<T>(fn: (db: Db) => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn(db);
    db.exec("COMMIT");
    return out;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // A failed rollback must not mask the original error.
    }
    throw err;
  }
}

/** SQLite's unique-constraint failure, in either the message or code form. */
function isUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(message);
}

/**
 * Creates a notification unless the same logical event already exists.
 *
 * The dedupe key (and the `notifications_event_once_idx` unique index) is what
 * stops a repeated tick or a second loser from notifying the same person twice.
 */
function notify(
  db: Db,
  args: {
    userId: string;
    kind: string;
    title: string;
    body: string;
    requestId?: string | null;
    alertId?: number | null;
    dedupeKey?: string | null;
    link?: string | null;
  },
): void {
  db.prepare(
    `INSERT OR IGNORE INTO notifications
       (user_id, kind, title, body, request_id, alert_id, link, read_at, created_at, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    args.userId,
    args.kind,
    args.title,
    args.body,
    args.requestId ?? null,
    args.alertId ?? null,
    args.link ?? null,
    nowIso(),
    args.dedupeKey ?? null,
  );
}


/**
 * Marks a request's ring process finished and retires its still-open alerts.
 *
 * Mirrors `closeProcessForRequest` in the local engine: once a request is
 * settled, nothing may remain actionable on it.
 */
function closeProcess(
  db: Db,
  requestId: string,
  outcome: "accepted" | "request_closed" | "rings_exhausted",
): void {
  const at = nowIso();
  db.prepare(
    `UPDATE ring_progress
        SET finished_at = ?, outcome = ?, last_advanced_at = ?
      WHERE request_id = ? AND finished_at IS NULL`,
  ).run(at, outcome, at, requestId);
  db.prepare(
    `UPDATE donor_alerts
        SET status = 'expired'
      WHERE request_id = ? AND response IS NULL AND status IN ('sent','opened')`,
  ).run(requestId);
}

/**
 * Whether a donor may be alerted about, or accept, a request.
 *
 * The SAME rules as the local engine's `donorIsEligible`, in the same order:
 * active donor account, currently available, blood-group/component compatible,
 * and outside the application's donation interval. This is an APPLICATION-level
 * scheduling rule and never a medical judgement — the blood bank screens every
 * donor medically, and nothing here decides fitness to donate.
 */
function donorIsEligible(
  donor: {
    blood_group: string | null;
    availability: string | null;
    last_donation_date: string | null;
  },
  userStatus: string | null,
  userRole: string | null,
  request: { blood_group: string; blood_component: string },
  nowMs: number,
  cooldownDays: number,
): boolean {
  if (userStatus !== "active" || userRole !== "donor") return false;
  if (donor.availability !== "available") return false;
  if (!donor.blood_group) return false;
  if (!isBloodCompatible(donor.blood_group, request.blood_group, request.blood_component)) {
    return false;
  }
  if (donor.last_donation_date) {
    const last = new Date(`${donor.last_donation_date}T00:00:00Z`).getTime();
    if (Number.isFinite(last) && nowMs - last < cooldownDays * 86_400_000) return false;
  }
  return true;
}

/* ------------------------------------------------------------- expiry (tick) */

/**
 * Expires every ACTIVE request whose deadline has passed, and returns how many
 * were closed.
 *
 * This is the third lifecycle transition (active -> expired) with no timer: the
 * deadline is compared against the clock on every call, so a stale request
 * closes the next time anything touches the workflow. Terminal states are
 * terminal, so an already-closed request is never re-expired and a fulfilled one
 * is never downgraded to expired.
 */
export function expireStaleRequests(): number {
  const at = nowIso();
  return transaction((db) => {
    const stale = db
      .prepare(
        `SELECT id, requester_id, units, blood_group, locality
           FROM blood_requests
          WHERE status = 'active' AND required_by <= ?`,
      )
      .all(at) as Row[];

    for (const r of stale) {
      // The `status = 'active'` predicate makes this a compare-and-set: whoever
      // changes the row first wins and the loser closes nothing.
      const closed = db
        .prepare(
          `UPDATE blood_requests
              SET status = 'expired', updated_at = ?
            WHERE id = ? AND status = 'active'`,
        )
        .run(at, r.id as string);
      if (Number(closed.changes) === 0) continue;
      closeProcess(db, r.id as string, "request_closed");
      notify(db, {
        userId: r.requester_id as string,
        kind: "request_expired",
        title: "Your blood request expired",
        body: `The request for ${r.units} unit(s) of ${r.blood_group} at ${r.locality} passed its deadline and is now closed.`,
        requestId: r.id as string,
        dedupeKey: `expired-${r.id}`,
        link: "/dashboard/requester",
      });
    }
    return stale.length;
  });
}


/* ---------------------------------------------------- donor matching (rings) */

/**
 * Expands every active request by at most one ring and returns the number of
 * alerts created.
 *
 * The same rules the local engine applied, in the same order:
 *   1. anything past its deadline is expired first;
 *   2. a request that already has an accepted donor never expands again;
 *   3. rings widen 3 -> 7 -> 15 km, one ring per window, derived from STORED
 *      timestamps rather than a timer, so a late call advances only the rings
 *      actually earned;
 *   4. a donor is alerted at most once per request (UNIQUE(request_id, donor_id)
 *      plus the in-transaction set), however far the search widens;
 *   5. eligibility is re-checked at the moment of alerting, so a donor who became
 *      unavailable, incompatible, or inside their donation interval meanwhile is
 *      not contacted.
 *
 * Idempotent and safe to call from any server render.
 */
export function expandAlertRings(): number {
  expireStaleRequests();
  const cfg = settings();

  return transaction((db) => {
    const now = Date.now();
    const at = nowIso();
    let created = 0;
    const requests = db
      .prepare("SELECT * FROM blood_requests WHERE status = 'active' AND required_by > ?")
      .all(at) as Row[];
    for (const request of requests) {
      created += advanceRequestRings(db, request, cfg, now, at);
    }
    return created;
  });
}

/**
 * How far one request may widen on this tick, and to whom.
 *
 * Split out of the transaction body so `expandAlertRings` above reads as the
 * rule list, and this reads as the mechanics.
 */
function advanceRequestRings(
  db: Db,
  request: Row,
  cfg: ReturnType<typeof settings>,
  now: number,
  at: string,
): number {
  const id = request.id as string;
  let created = 0;

  // A winner stops every future ring.
  const won = db
    .prepare(
      `SELECT 1 FROM donor_alerts
        WHERE request_id = ? AND response = 'accepted' LIMIT 1`,
    )
    .get(id);
  if (won) {
    closeProcess(db, id, "accepted");
    return 0;
  }

  const last = db
    .prepare(
      `SELECT ring_index, started_at FROM ring_progress
        WHERE request_id = ? ORDER BY ring_index DESC LIMIT 1`,
    )
    .get(id) as Row | undefined;

  const targetIndex = last ? Math.min(Number(last.ring_index), cfg.rings.length) : 0;
  if (targetIndex >= cfg.rings.length || targetIndex >= cfg.maxRings) {
    closeProcess(db, id, "rings_exhausted");
    return 0;
  }
  if (last) {
    const elapsed = (now - new Date(String(last.started_at)).getTime()) / 60_000;
    if (elapsed < cfg.windowMinutes) return 0; // still inside the window
  }


  const ringKm = cfg.rings[targetIndex];
  // Never alert the same donor twice for one request, however far we widen.
  const already = new Set(
    (db.prepare("SELECT donor_id FROM donor_alerts WHERE request_id = ?").all(id) as Row[]).map(
      (r) => r.donor_id as string,
    ),
  );

  const candidates = db
    .prepare(
      `SELECT dp.user_id, dp.blood_group, dp.availability, dp.last_donation_date,
              dp.latitude, dp.longitude, u.status, u.role
         FROM donor_profiles dp
         JOIN users u ON u.id = dp.user_id`,
    )
    .all() as Row[];

  for (const c of candidates) {
    const donorId = c.user_id as string;
    if (already.has(donorId)) continue;
    const eligible = donorIsEligible(
      {
        blood_group: (c.blood_group as string | null) ?? null,
        availability: (c.availability as string | null) ?? null,
        last_donation_date: (c.last_donation_date as string | null) ?? null,
      },
      (c.status as string | null) ?? null,
      (c.role as string | null) ?? null,
      {
        blood_group: request.blood_group as string,
        blood_component: request.blood_component as string,
      },
      now,
      cfg.cooldownDays,
    );
    if (!eligible) continue;

    const distance = haversineKm(
      (request.latitude as number | null) ?? null,
      (request.longitude as number | null) ?? null,
      (c.latitude as number | null) ?? null,
      (c.longitude as number | null) ?? null,
    );
    // With no coordinates the demo must still be able to show an alert, so
    // distance is treated as unknown rather than disqualifying. WITH coordinates
    // the ring radius is enforced strictly.
    if (distance !== null && distance > ringKm) continue;

    // The response window is bounded by the request's own deadline: contact can
    // never be shared past the moment the blood is needed.
    const deadline = new Date(String(request.required_by)).getTime();
    const due = Math.min(deadline - cfg.dueOffsetMinutes * 60_000, deadline);

    const info = db
      .prepare(
        `INSERT INTO donor_alerts
           (request_id, donor_id, ring_index, ring_km, status, response, due_at, created_at)
         VALUES (?, ?, ?, ?, 'sent', NULL, ?, ?)`,
      )
      .run(id, donorId, targetIndex + 1, ringKm, new Date(due).toISOString(), at);
    const alertId = Number(info.lastInsertRowid);
    already.add(donorId);
    created += 1;

    notify(db, {
      userId: donorId,
      kind: "alert_received",
      title: `Blood needed nearby — ${request.blood_group}`,
      body: `${request.units} unit(s) needed at ${request.locality}. This is an application-level alert; the blood bank decides medical eligibility.`,
      requestId: id,
      alertId,
      dedupeKey: `alert-${alertId}`,
      link: "/dashboard/donor",
    });
  }

  const progress = db
    .prepare("SELECT 1 FROM ring_progress WHERE request_id = ? AND ring_index = ?")
    .get(id, targetIndex + 1);
  if (progress) {
    db.prepare(
      "UPDATE ring_progress SET last_advanced_at = ? WHERE request_id = ? AND ring_index = ?",
    ).run(at, id, targetIndex + 1);
  } else {
    db.prepare(
      `INSERT INTO ring_progress
         (request_id, ring_index, started_at, last_advanced_at, finished_at, outcome)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
    ).run(id, targetIndex + 1, at, at);
  }
  return created;
}


/* ------------------------------------------------ donor response (the race) */

/**
 * Records ONE donor's answer to ONE of their own alerts. FIRST-VALID-DONOR-WINS.
 *
 * The winner is chosen by the DATABASE. Inside one transaction this re-reads the
 * alert, re-checks that the request is still open and the donor still eligible,
 * and then writes the response — but the actual guarantee is the partial unique
 * index `donor_alerts_one_acceptance_idx` on `request_id` alone. A second donor
 * accepting the same request raises a constraint error, which is reported as
 * `already_taken`. There is deliberately NO "has someone accepted yet?" pre-check
 * standing in for that index: the loser must lose because the database refused
 * the write, not because a check happened to say so.
 *
 * `caller.id` is the session's user. A donor may only answer an alert addressed
 * to them, and that is re-checked here rather than trusted from the caller.
 *
 * Returns the outcome code the UI already knows how to render.
 */
export function markAlertResponded(
  caller: RequestCaller,
  alertId: number,
  response: string,
): RespondOutcome {
  if (response !== "accepted" && response !== "declined") return "invalid_response";
  // A non-donor holds no alerts, so this leaks nothing about any request.
  if (caller.role !== "donor") return "not_your_alert";

  const cfg = settings();
  const resolve = (): RespondOutcome =>
    transaction((db) => {
      const alert = db.prepare("SELECT * FROM donor_alerts WHERE id = ?").get(alertId) as
        | Row
        | undefined;
      if (!alert) return "not_found" as RespondOutcome;
      // Ownership: the session's own donor id, never anything the payload said.
      if (alert.donor_id !== caller.id) return "not_your_alert";
      if (alert.response !== null) return "already_responded";

      const request = db
        .prepare("SELECT * FROM blood_requests WHERE id = ?")
        .get(alert.request_id as string) as Row | undefined;
      if (!request || request.status !== "active") return "request_closed";
      if (new Date(String(request.required_by)).getTime() <= Date.now()) {
        return "request_closed";
      }
      if (alert.status !== "sent" && alert.status !== "opened") return "request_closed";

      const donor = db
        .prepare(
          `SELECT dp.blood_group, dp.availability, dp.last_donation_date, u.status, u.role
             FROM donor_profiles dp JOIN users u ON u.id = dp.user_id
            WHERE dp.user_id = ?`,
        )
        .get(caller.id) as Row | undefined;
      if (
        !donor ||
        !donorIsEligible(
          {
            blood_group: (donor.blood_group as string | null) ?? null,
            availability: (donor.availability as string | null) ?? null,
            last_donation_date: (donor.last_donation_date as string | null) ?? null,
          },
          (donor.status as string | null) ?? null,
          (donor.role as string | null) ?? null,
          {
            blood_group: request.blood_group as string,
            blood_component: request.blood_component as string,
          },
          Date.now(),
          cfg.cooldownDays,
        )
      ) {
        return "not_eligible";
      }

      // THE WRITE. If another donor already holds the acceptance this raises a
      // constraint error; it is caught below and reported as already_taken.
      db.prepare(
        `UPDATE donor_alerts
            SET response = ?, status = 'responded', responded_at = ?
          WHERE id = ? AND response IS NULL`,
      ).run(response, nowIso(), alertId);

      if (response === "declined") return "declined" as RespondOutcome;

      // Accepted. Stop the ring, then tell everyone still waiting.
      closeProcess(db, String(request.id), "accepted");
      announceAcceptance(db, request, alertId, caller.id);
      return "accepted" as RespondOutcome;
    });

  try {
    return resolve();
  } catch (err) {
    if (isUniqueViolation(err)) return "already_taken";
    throw err;
  }
}


/**
 * Fan-out for a winning acceptance: the other waiting donors, the winner, the
 * requester, and an audit row. Runs inside the same transaction as the write, so
 * a rollback takes the notifications with it.
 */
function announceAcceptance(db: Db, request: Row, alertId: number, donorId: string): void {
  const requestId = String(request.id);
  for (const other of db
    .prepare(
      `SELECT id, donor_id FROM donor_alerts
        WHERE request_id = ? AND id <> ? AND response IS NULL`,
    )
    .all(requestId, alertId) as Row[]) {
    notify(db, {
      userId: other.donor_id as string,
      kind: "already_accepted",
      title: "Another donor responded first",
      body: "Someone else accepted the blood request you were alerted about, so your response is no longer needed. No action is required — thank you for being ready to help.",
      requestId,
      alertId: Number(other.id),
      dedupeKey: `already-accepted-${other.id}`,
      link: "/dashboard/donor",
    });
  }

  notify(db, {
    userId: donorId,
    kind: "acceptance_confirmed",
    title: "You accepted this request",
    body: `Thank you — your acceptance is recorded for the ${request.blood_group} need at ${request.locality}. The requester can see your name and phone until the response window closes.`,
    requestId,
    alertId,
    dedupeKey: `acceptance-${alertId}`,
    link: "/dashboard/donor",
  });
  notify(db, {
    userId: request.requester_id as string,
    kind: "donor_accepted",
    title: "A donor accepted your blood request",
    body: `An alerted donor responded yes for ${request.units} unit(s) of ${request.blood_group} at ${request.locality}. Their contact is on your request until the deadline.`,
    requestId,
    alertId,
    dedupeKey: `donor-accepted-${alertId}`,
    link: "/dashboard/requester",
  });
  db.prepare(
    `INSERT INTO audit_events (id, actor_id, action, entity, entity_id, metadata, created_at)
     VALUES (?, ?, 'accept_request', 'blood_request', ?, NULL, ?)`,
  ).run(`audit-${randomUUID()}`, donorId, requestId, nowIso());
}

/* ------------------------------------------------------ requester lifecycle */

/**
 * The requester's own cancel/fulfil, as a single guarded transition.
 *
 * `active -> fulfilled` and `active -> cancelled` are the only transitions a
 * requester may cause. The UPDATE itself is the authorisation: it is scoped to
 * `requester_id = caller.id` AND `status = 'active'`, so a crafted request id
 * belonging to somebody else matches zero rows and can neither be read nor
 * closed. There is deliberately no separate "is this yours?" check that could
 * drift out of step with the write.
 *
 * Cancellation stays possible after a donor has accepted — a requester's need
 * going away outranks the match — which is why acceptance is not consulted here.
 * Terminal states stay terminal: the `status = 'active'` predicate together with
 * the `blood_requests_terminal_guard` trigger refuse any second transition.
 */
export function closeRequestAsRequester(
  caller: RequestCaller,
  requestId: string,
  status: RequesterClosable,
): {
  ok: boolean;
  /** `no_accepted_donor` is the RS003 refusal, which carries `message` verbatim. */
  reason?: "not_found" | "already_closed" | "no_accepted_donor";
  message?: string;
} {
  const at = nowIso();
  return transaction((db) => {
    const existing = db
      .prepare("SELECT status FROM blood_requests WHERE id = ?")
      .get(requestId) as Row | undefined;
    // A row that exists but is not the caller's is reported exactly like one
    // that does not exist, so this cannot be used to probe for other people's
    // request ids.
    if (!existing || existing.status !== "active") {
      return { ok: false, reason: "already_closed" };
    }

    // RS003: a request can only be FULFILLED once a donor has accepted it.
    // Cancellation is deliberately exempt — a requester's need going away
    // outranks the match, and that stays possible after an acceptance.
    //
    // This is a business rule the DATABASE used to enforce with a trigger, so it
    // is re-checked here, inside the same transaction and BEFORE the write, and
    // refused with the same code and the same full sentence that
    // `fulfillBloodRequest` surfaces instead of a generic failure. A SQLite
    // trigger cannot raise a Postgres SQLSTATE this adapter recognises, so the
    // guard lives in the transaction that would do the write. It must precede
    // the UPDATE: returning afterwards would still COMMIT the status change,
    // which is exactly the outcome the rule forbids.
    if (status === "fulfilled") {
      const accepted = db
        .prepare(
          `SELECT 1 FROM donor_alerts
            WHERE request_id = ? AND response = 'accepted' LIMIT 1`,
        )
        .get(requestId);
      if (!accepted) {
        return {
          ok: false,
          reason: "no_accepted_donor",
          message:
            "A request can only be marked fulfilled once a donor has accepted it. Cancel the request instead if the blood is no longer needed.",
        };
      }
    }

    const stampColumn = status === "cancelled" ? "cancelled_at" : "fulfilled_at";
    const info = db
      .prepare(
        `UPDATE blood_requests
            SET status = ?, updated_at = ?, ${stampColumn} = ?
          WHERE id = ? AND requester_id = ? AND status = 'active'`,
      )
      .run(status, at, at, requestId, caller.id);

    // A live request that matched no rows means the caller does not own it.
    if (Number(info.changes) === 0) return { ok: false, reason: "not_found" };

    closeProcess(db, requestId, "request_closed");

    const request = db
      .prepare("SELECT * FROM blood_requests WHERE id = ?")
      .get(requestId) as Row;

    notify(db, {
      userId: caller.id,
      kind: `request_${status}`,
      title: `Your blood request was ${status}`,
      body: `The ${request.blood_group} request at ${request.locality} is now ${status}. Alerting has stopped.`,
      requestId,
      dedupeKey: `${status}-${requestId}`,
      link: "/dashboard/requester",
    });
    for (const a of db
      .prepare(
        `SELECT id, donor_id FROM donor_alerts
          WHERE request_id = ? AND response IS NULL`,
      )
      .all(requestId) as Row[]) {
      notify(db, {
        userId: a.donor_id as string,
        kind: "request_closed",
        title: "A request you were alerted about is closed",
        body: `The ${request.blood_group} request at ${request.locality} is now ${status}, so no response is needed. Thank you for being ready to help.`,
        requestId,
        alertId: Number(a.id),
        dedupeKey: `request-closed-${a.id}`,
        link: "/dashboard/donor",
      });
    }
    return { ok: true };
  });
}


/**
 * Records one completed donation against an accepted request.
 *
 * This is an administrative record of what the blood bank already did — it
 * asserts nothing about medical eligibility. The acceptance is re-checked inside
 * the transaction, so a donation can never be recorded against a request with no
 * accepted donor, and the donor/day guard is what stops a repeated submission
 * from inflating recognition.
 */
export function recordDonation(
  caller: RequestCaller,
  requestId: string,
  units: number,
): { ok: true } | { ok: false; error: string } {
  return transaction((db) => {
    const request = db
      .prepare("SELECT * FROM blood_requests WHERE id = ?")
      .get(requestId) as Row | undefined;
    if (!request) return { ok: false as const, error: "That request could not be found." };

    const winner = db
      .prepare(
        `SELECT donor_id FROM donor_alerts
          WHERE request_id = ? AND response = 'accepted' LIMIT 1`,
      )
      .get(requestId) as Row | undefined;
    if (!winner) {
      return {
        ok: false as const,
        error: "A donation can only be recorded once a donor has accepted this request.",
      };
    }
    if (winner.donor_id !== caller.id) {
      return { ok: false as const, error: "A different donor accepted this request." };
    }

    const donatedOn = nowIso().slice(0, 10);
    const duplicate = db
      .prepare("SELECT 1 FROM donations WHERE donor_id = ? AND donated_on = ? LIMIT 1")
      .get(caller.id, donatedOn);
    if (duplicate) {
      return {
        ok: false as const,
        error: "A donation is already recorded for this donor today.",
      };
    }

    const count = Number.isFinite(units) && units > 0 ? Math.floor(units) : 1;
    db.prepare(
      `INSERT INTO donations
         (id, donor_id, request_id, drive_id, donated_on, blood_component, units, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
    ).run(
      `don-${randomUUID()}`,
      caller.id,
      requestId,
      donatedOn,
      String(request.blood_component),
      count,
      nowIso(),
    );

    // Keep the donor's own eligibility tracking in step with the ledger.
    db.prepare(
      `UPDATE donor_profiles
          SET last_donation_date = ?,
              donation_count = COALESCE(donation_count, 0) + 1,
              updated_at = ?
        WHERE user_id = ?`,
    ).run(donatedOn, nowIso(), caller.id);

    notify(db, {
      userId: caller.id,
      kind: "recognition_milestone",
      title: "Your donation was recorded",
      body: "Thank you — your donation is now on your record. Recognition counts recorded donations only; medical eligibility is always decided by the blood bank.",
      requestId,
      dedupeKey: `donation-${requestId}`,
      link: "/dashboard/donor",
    });
    db.prepare(
      `INSERT INTO audit_events (id, actor_id, action, entity, entity_id, metadata, created_at)
       VALUES (?, ?, 'record_donation', 'blood_request', ?, NULL, ?)`,
    ).run(`audit-${randomUUID()}`, caller.id, requestId, nowIso());

    return { ok: true as const };
  });
}


/* ------------------------------------------------------------------ matching */

/** The row shape `src/lib/matching.ts` already consumes. */
export interface MatchedDonorRow {
  donor_id: string;
  full_name: string;
  blood_group: string;
  /** General location only — never a street address. */
  locality: string | null;
  distance_km: number | null;
}

/** A request the caller is allowed to match against, or null. */
function ownableRequest(caller: RequestCaller, requestId: string): Row | null {
  const request = getDb()
    .prepare("SELECT * FROM blood_requests WHERE id = ?")
    .get(requestId) as Row | undefined;
  if (!request) return null;
  // A request belonging to somebody else resolves to the SAME "no such request"
  // answer as one that does not exist, so this cannot be used to discover other
  // people's request ids.
  if (request.requester_id !== caller.id && caller.role !== "admin") return null;
  return request;
}

/**
 * Eligible donors for a request the caller owns (admins may read any).
 *
 * Returns an empty list — never somebody else's data — when the request is
 * missing, not the caller's, or no longer active. The SAME eligibility rules as
 * the ring engine are applied, so a donor listed here is one who would actually
 * be alerted.
 *
 * The shape carries NO phone number and NO street address. A general locality
 * plus distance is what a donor needs in order to decide; contact details are
 * revealed only after a valid acceptance, and only to the requester.
 */
export function matchDonorsForRequest(
  caller: RequestCaller,
  requestId: string,
  radiusKm: number | null,
  limit: number,
): { data: MatchedDonorRow[] | null; error: { message: string } | null } {
  const request = ownableRequest(caller, requestId);
  if (!request) return { data: null, error: { message: "No such request." } };
  if (request.status !== "active") return { data: [], error: null };

  const cfg = settings();
  const now = Date.now();
  const maxKm =
    typeof radiusKm === "number" && Number.isFinite(radiusKm) && radiusKm > 0
      ? radiusKm
      : Math.max(...cfg.rings);
  const cap = Math.min(Math.max(Math.floor(limit) || 50, 1), 200);

  const candidates = getDb()
    .prepare(
      `SELECT dp.user_id, dp.blood_group, dp.availability, dp.last_donation_date,
              dp.latitude, dp.longitude, dp.locality, u.full_name, u.status, u.role
         FROM donor_profiles dp
         JOIN users u ON u.id = dp.user_id`,
    )
    .all() as Row[];

  const matched: MatchedDonorRow[] = candidates
    .filter((c) =>
      donorIsEligible(
        {
          blood_group: (c.blood_group as string | null) ?? null,
          availability: (c.availability as string | null) ?? null,
          last_donation_date: (c.last_donation_date as string | null) ?? null,
        },
        (c.status as string | null) ?? null,
        (c.role as string | null) ?? null,
        {
          blood_group: request.blood_group as string,
          blood_component: request.blood_component as string,
        },
        now,
        cfg.cooldownDays,
      ),
    )
    .map((c) => ({
      donor_id: c.user_id as string,
      full_name: c.full_name as string,
      blood_group: c.blood_group as string,
      locality: (c.locality as string | null) ?? null,
      distance_km: haversineKm(
        (request.latitude as number | null) ?? null,
        (request.longitude as number | null) ?? null,
        (c.latitude as number | null) ?? null,
        (c.longitude as number | null) ?? null,
      ),
    }))
    .filter((d) => d.distance_km === null || d.distance_km <= maxKm)
    .sort((a, b) => {
      // Donors without coordinates sort last but are never dropped.
      if (a.distance_km === null) return b.distance_km === null ? 0 : 1;
      if (b.distance_km === null) return -1;
      return a.distance_km - b.distance_km;
    })
    .slice(0, cap);

  return { data: matched, error: null };
}

/**
 * Donor counts for a request, in the shape `getMatchSummary` consumes.
 *
 * Same ownership rule as above, so a request belonging to somebody else resolves
 * to no row at all and the caller cannot learn that it exists.
 */
export function matchingDonorStats(
  caller: RequestCaller,
  requestId: string,
): { data: Row[] | null; error: { message: string } | null } {
  const request = ownableRequest(caller, requestId);
  if (!request) return { data: null, error: { message: "No such request." } };

  const rows = (matchDonorsForRequest(caller, requestId, null, 200).data ?? []) as MatchedDonorRow[];
  const within = (km: number): number =>
    rows.filter((r) => r.distance_km !== null && r.distance_km <= km).length;

  return {
    data: [
      {
        is_active: request.status === "active",
        hospital_has_location:
          request.latitude !== null && request.latitude !== undefined,
        total_compatible: rows.length,
        with_location: rows.filter((r) => r.distance_km !== null).length,
        within_3km: within(3),
        within_7km: within(7),
        within_15km: within(15),
      },
    ],
    error: null,
  };
}

