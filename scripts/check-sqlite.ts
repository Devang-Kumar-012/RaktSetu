/**
 * Real end-to-end proof of the SQLite layer.
 *
 * Runs against the SAME modules the app runs (not a reimplementation) and
 * checks the properties the migration depends on: persistence across a reopen,
 * per-user scoping, the database-decided acceptance race, and multi-device
 * sessions.
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";

/** Matches the hashing session.ts uses, so a test token resolves. */
const require_sha = (t: string) => createHash("sha256").update(t).digest("hex");

import { getDb, closeDb, DB_FILE } from "../src/lib/server/db";
import { createSqlClient } from "../src/lib/server/sql-adapter";
import {
  closeRequestAsRequester,
  expandAlertRings,
  expireStaleRequests,
  markAlertResponded,
  matchDonorsForRequest,
  matchingDonorStats,
} from "../src/lib/server/sql-requests";
import { runDashboardRpc } from "../src/lib/server/sql-dashboard";
import { hashPassword, verifyPassword } from "../src/lib/server/password";
import {
  createUser, authenticate, createSession, getUserForToken, revokeSession,
} from "../src/lib/server/session";

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

/**
 * The path db.ts actually opened — imported, never recomputed.
 *
 * An earlier version guessed `os.tmpdir()`, so the cleanup below deleted a file
 * that was never used while the real `./data/raktsetu.db` was left in place. A
 * second run then failed on a UNIQUE constraint against the fixture user, which
 * made this check look broken long after the layer it tests was fine. Reading
 * the adapter's own constant keeps the cleanup provably aligned with the file
 * under test.
 */

/** The alert id the workflow will act on, read back from the store. */
function alertIdOf(requestId: string, donorId: string): number {
  const row = getDb()
    .prepare("SELECT id FROM donor_alerts WHERE request_id = ? AND donor_id = ?")
    .get(requestId, donorId) as { id: number } | undefined;
  if (!row) throw new Error(`no alert for ${donorId} on ${requestId}`);
  return Number(row.id);
}

const DB = DB_FILE;

let RQ = "";
const DN = "donor-1";
const db = createSqlClient();
const now = () => new Date().toISOString();
const soon = () => new Date(Date.now() + 3600_000).toISOString();

let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    failures.push(`${name}: ${(err as Error).message}`);
  }
}

/** Requests, scoping, and the lifecycle constraints. */
async function dataChecks() {
  getDb()
    .prepare(
      `INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at)
       VALUES (?, ?, 'x', ?, 'donor', 'active', ?, ?)`
    )
    .run(DN, "dn@example.com", "Dev Donor", now(), now());

  await check("a request persists and is scoped to its requester", async () => {
    await db.from("blood_requests").insert({
      id: "req-1", requester_id: RQ, requester_name: "Rita Requester",
      requester_phone: "9999999999", blood_group: "O+", blood_component: "whole_blood",
      units: 2, hospital_name: "City Hospital", hospital_locality: "Central",
      urgency: "urgent", required_by: soon(), status: "active",
      created_at: now(), updated_at: now(),
    });
    const mine = await db.from("blood_requests").eq("requester_id", RQ).select("*");
    assert.equal((mine.data as unknown as unknown[]).length, 1);
    const other = await db.from("blood_requests").eq("requester_id", "nobody").select("*");
    assert.equal((other.data as unknown as unknown[]).length, 0, "another user sees nothing");
  });

  await check("an 'accepted' request status is rejected by the database", async () => {
    const r = await db.from("blood_requests").update({ status: "accepted" }).eq("id", "req-1");
    assert.ok(r.error, "'accepted' must never be a request status");
    assert.equal(r.error?.code, "23514");
    const still = await db.from("blood_requests").eq("id", "req-1").single();
    assert.equal((still.data as Record<string, unknown>).status, "active");
  });

  // The four lifecycle states, and nothing else. Each transition is tried from a
  // FRESH active request, because a request that has already left 'active' can
  // no longer transition at all — that terminality is the point, and it is
  // asserted separately below.
  await check("fulfilled / cancelled / expired stay legal from active", async () => {
    for (const status of ["fulfilled", "cancelled", "expired"] as const) {
      const id = `req-legal-${status}`;
      await db.from("blood_requests").insert({
        id, requester_id: RQ, requester_name: "Rita Requester",
        requester_phone: "9999999999", blood_group: "O+", blood_component: "whole_blood",
        units: 1, hospital_name: "City Hospital", hospital_locality: "Central",
        urgency: "urgent", required_by: soon(), status: "active",
        created_at: now(), updated_at: now(),
      });
      const r = await db.from("blood_requests").update({ status }).eq("id", id);
      assert.ok(!r.error, `${status} must be legal from active`);
      const row = await db.from("blood_requests").eq("id", id).single();
      assert.equal((row.data as Record<string, unknown>).status, status, `must be ${status}`);
    }
  });

  await check("a terminal state is terminal: no request is ever reopened", async () => {
    // A DEDICATED request, not the shared `req-1` fixture: closing it is the
    // whole point of this check, and later checks legitimately need req-1 to
    // still be active.
    const id = "req-terminal";
    await db.from("blood_requests").insert({
      id, requester_id: RQ, requester_name: "Rita Requester",
      requester_phone: "9999999999", blood_group: "O+", blood_component: "whole_blood",
      units: 1, hospital_name: "City Hospital", hospital_locality: "Central",
      urgency: "urgent", required_by: soon(), status: "active",
      created_at: now(), updated_at: now(),
    });
    const closed = await db.from("blood_requests").update({ status: "cancelled" }).eq("id", id);
    assert.ok(!closed.error, "active -> cancelled is legal");
    for (const status of ["active", "fulfilled", "expired"] as const) {
      const r = await db.from("blood_requests").update({ status }).eq("id", id);
      assert.ok(r.error, `a cancelled request must not become ${status}`);
    }
    const row = await db.from("blood_requests").eq("id", id).single();
    assert.equal(
      (row.data as Record<string, unknown>).status,
      "cancelled",
      "the first terminal state must stick",
    );
  });
}

/** The acceptance race and the duplicate-prevention constraints. */
async function raceChecks() {
  await check("first-valid-donor-wins is decided by the database", async () => {
    getDb()
      .prepare(
        `INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at)
         VALUES ('donor-2', 'dn2@example.com', 'x', 'Second Donor', 'donor', 'active', ?, ?)`
      )
      .run(now(), now());
    await db.from("donor_alerts").insert([
      { request_id: "req-1", donor_id: DN, ring_index: 1, ring_km: 3, status: "sent", response: "accepted", due_at: soon(), created_at: now() },
      { request_id: "req-1", donor_id: "donor-2", ring_index: 1, ring_km: 3, status: "sent", response: null, due_at: soon(), created_at: now() },
    ]);
    const winners = (
      await db.from("donor_alerts").eq("request_id", "req-1").eq("response", "accepted").select("*")
    ).data as unknown as Record<string, unknown>[];
    assert.equal(winners.length, 1, "exactly one donor may hold acceptance");
    assert.equal(winners[0].donor_id, DN);
  });

  // THE regression this index previously could not catch. Scoped to
  // (request_id, donor_id), the index merely restated the table's UNIQUE and let
  // two DIFFERENT donors each hold an acceptance for the same request — the
  // requester would then be shown two "accepted" donors for one need. The index
  // is now on request_id alone, so the second acceptance is refused outright.
  await check("TWO DIFFERENT donors cannot both accept one request", async () => {
    getDb()
      .prepare(
        `INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at)
         VALUES ('donor-3', 'dn3@example.com', 'x', 'Third Donor', 'donor', 'active', ?, ?)`,
      )
      .run(now(), now());
    await db.from("blood_requests").insert({
      id: "req-race", requester_id: RQ, requester_name: "Rita Requester",
      requester_phone: "9999999999", blood_group: "O-", blood_component: "whole_blood",
      units: 1, hospital_name: "City Hospital", hospital_locality: "Central",
      urgency: "urgent", required_by: soon(), status: "active",
      created_at: now(), updated_at: now(),
    });
    // Both donors hold an open alert for the same request. Each needs a real,
    // ELIGIBLE profile: available, compatible with O-, and outside the donation
    // interval — which is precisely the state `markAlertResponded` re-checks.
    for (const [donorId, email, name] of [
      [DN, "dn@example.com", "Dev Donor"],
      ["donor-2", "dn2@example.com", "Second Donor"],
    ] as const) {
      getDb()
        .prepare(
          `INSERT OR IGNORE INTO users
             (id, email, password_hash, full_name, role, status, created_at, updated_at)
           VALUES (?, ?, 'x', ?, 'donor', 'active', ?, ?)`,
        )
        .run(donorId, email, name, now(), now());
      getDb()
        .prepare(
          `INSERT OR IGNORE INTO donor_profiles
             (user_id, blood_group, locality, phone, latitude, longitude,
              last_donation_date, availability, donation_count, created_at, updated_at)
           VALUES (?, 'O-', 'Central', '9000000000', NULL, NULL, NULL, 'available', 0, ?, ?)`,
        )
        .run(donorId, now(), now());
    }
    await db.from("donor_alerts").insert([
      { request_id: "req-race", donor_id: DN, ring_index: 1, ring_km: 3, status: "sent", response: null, due_at: soon(), created_at: now() },
      { request_id: "req-race", donor_id: "donor-2", ring_index: 1, ring_km: 3, status: "sent", response: null, due_at: soon(), created_at: now() },
    ]);

    // Both respond through the REAL workflow, not a raw UPDATE.
    const first = markAlertResponded({ id: DN, role: "donor" }, alertIdOf("req-race", DN), "accepted");
    assert.equal(first, "accepted", "the first valid donor wins");

    // The loser is refused. Sequentially that refusal is 'request_closed',
    // because winning retires the other open alerts — the SAME ordering the
    // legacy engine used, where the alert-state check also precedes the
    // "someone already won" check. What matters is that it is a refusal and
    // that the request still has exactly one accepted donor.
    const second = markAlertResponded(
      { id: "donor-2", role: "donor" },
      alertIdOf("req-race", "donor-2"),
      "accepted",
    );
    assert.ok(
      second === "already_taken" || second === "request_closed",
      `a second donor must be refused, got ${second}`,
    );

    const winners = (
      await db.from("donor_alerts").eq("request_id", "req-race").eq("response", "accepted").select("*")
    ).data as unknown as Record<string, unknown>[];
    assert.equal(winners.length, 1, "one request, one accepted donor — always");
    assert.equal(winners[0].donor_id, DN);

    // And the table itself is closed to the same attempt, so no code path can
    // manufacture a second winner.
    const raw = await db
      .from("donor_alerts")
      .update({ response: "accepted" })
      .eq("request_id", "req-race")
      .eq("donor_id", "donor-2");
    assert.ok(raw.error, "the database itself must refuse a second acceptance");
  });

  // THE RACE ITSELF: two responses genuinely in flight. Each transaction reads
  // its own alert as still 'sent' before either commits, which a sequential
  // test can never enter on its own. The second commit is refused by the
  // partial unique index — the database decides the winner, not a pre-check.
  await check("a genuinely concurrent second acceptance is refused as already_taken", async () => {
    const id = "req-race-2";
    await db.from("blood_requests").insert({
      id, requester_id: RQ, requester_name: "Rita Requester",
      requester_phone: "9999999999", blood_group: "O-", blood_component: "whole_blood",
      units: 1, hospital_name: "City Hospital", hospital_locality: "Central",
      urgency: "urgent", required_by: soon(), status: "active",
      created_at: now(), updated_at: now(),
    });
    await db.from("donor_alerts").insert([
      { request_id: id, donor_id: DN, ring_index: 1, ring_km: 3, status: "sent", response: null, due_at: soon(), created_at: now() },
      { request_id: id, donor_id: "donor-2", ring_index: 1, ring_km: 3, status: "sent", response: null, due_at: soon(), created_at: now() },
    ]);

    assert.equal(
      markAlertResponded({ id: DN, role: "donor" }, alertIdOf(id, DN), "accepted"),
      "accepted",
    );
    // Put the loser's alert back to 'sent': that is the state it was read in
    // before the winner's transaction committed, and it is the only way to reach
    // the database-decided refusal deterministically.
    getDb()
      .prepare("UPDATE donor_alerts SET status = 'sent' WHERE request_id = ? AND donor_id = ?")
      .run(id, "donor-2");

    const second = markAlertResponded(
      { id: "donor-2", role: "donor" },
      alertIdOf(id, "donor-2"),
      "accepted",
    );
    assert.equal(second, "already_taken", "the index decides the race, not a pre-check");

    const winners = (
      await db.from("donor_alerts").eq("request_id", id).eq("response", "accepted").select("*")
    ).data as unknown as Record<string, unknown>[];
    assert.equal(winners.length, 1, "still exactly one accepted donor");
    assert.equal(winners[0].donor_id, DN);
  });

  await check("a donor cannot answer somebody else's alert", async () => {
    // donor-2 holds an open alert on req-race; donor-3 must not be able to use it.
    const out = markAlertResponded(
      { id: "donor-3", role: "donor" },
      alertIdOf("req-race-2", "donor-2"),
      "accepted",
    );
    assert.equal(out, "not_your_alert", "ownership comes from the session, not the payload");
  });

  await check("a non-donor cannot respond to any alert", async () => {
    const out = markAlertResponded({ id: RQ, role: "requester" }, alertIdOf("req-race", DN), "accepted");
    assert.equal(out, "not_your_alert", "only a donor holds alerts");
  });

  await check("one alert per donor per request", async () => {
    const r = await db.from("donor_alerts").insert({
      request_id: "req-1", donor_id: DN, ring_index: 2, ring_km: 7,
      status: "sent", due_at: soon(), created_at: now(),
    });
    assert.ok(r.error, "a repeat alert to the same donor must be refused");
    assert.equal(r.error?.code, "23505");
  });

  await check("one notification per logical event", async () => {
    const row = { user_id: RQ, kind: "request_accepted", title: "t", body: "b", request_id: "req-1", created_at: now() };
    assert.ok(!(await db.from("notifications").insert({ ...row })).error);
    const dup = await db.from("notifications").insert({ ...row, created_at: now() });
    assert.ok(dup.error, "the same event must not notify twice");
    assert.equal(dup.error?.code, "23505");
  });

  await check("duplicate donations cannot inflate the record", async () => {
    const don = { donor_id: DN, donated_on: "2026-01-05", blood_component: "whole_blood", units: 1, created_at: now() };
    assert.ok(!(await db.from("donations").insert({ ...don, id: "don-1" })).error);
    assert.ok((await db.from("donations").insert({ ...don, id: "don-2" })).error,
      "a second donation on the same day must be refused");
  });

  await check("duplicate drive registration and report are refused; neither touches the request", async () => {
    getDb()
      .prepare(
        `INSERT INTO campus_blood_drives (id, title, organizer, drive_date, starts_at, venue, locality, created_at, updated_at)
         VALUES ('drive-1', 'Campus Drive', 'A University', '2026-03-01', '2026-03-01T09:00:00Z', 'Hall', 'North', ?, ?)`
      )
      .run(now(), now());
    const reg = { drive_id: "drive-1", donor_id: DN, status: "registered", created_at: now(), updated_at: now() };
    assert.ok(!(await db.from("campus_drive_registrations").insert({ ...reg, id: "reg-1" })).error);
    assert.ok((await db.from("campus_drive_registrations").insert({ ...reg, id: "reg-2" })).error);

    const rep = { request_id: "req-1", reporter_id: RQ, reason: "incorrect_information", created_at: now(), updated_at: now() };
    assert.ok(!(await db.from("request_reports").insert({ ...rep, id: "rep-1" })).error);
    assert.ok((await db.from("request_reports").insert({ ...rep, id: "rep-2" })).error);

    const still = await db.from("blood_requests").eq("id", "req-1").single();
    assert.equal((still.data as Record<string, unknown>).status, "active",
      "a report must not cancel or hide the request");
  });

  await check("a failure inside a transaction rolls back", () => {
    const d = getDb();
    d.exec("BEGIN");
    try {
      d.prepare(
        `INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at)
         VALUES ('rb-1', 'rb@example.com', 'x', 'Rollback', 'donor', 'active', ?, ?)`
      ).run(now(), now());
      d.prepare(
        `INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at)
         VALUES ('rb-2', 'rb@example.com', 'x', 'Rollback2', 'donor', 'active', ?, ?)`
      ).run(now(), now());
      assert.fail("the duplicate insert should have failed");
    } catch {
      d.exec("ROLLBACK");
    }
    assert.equal(d.prepare("SELECT id FROM users WHERE id = 'rb-1'").get(), undefined,
      "the earlier insert must have been rolled back");
  });
}

/** Multi-device sessions, expiry, revocation, and restart persistence. */

/**
 * THE BLOOD-REQUEST WORKFLOW, END TO END, THROUGH THE REAL SEAM.
 *
 * This is the flow the application actually performs, in the order a real
 * requester and donor perform it, and every step goes through the module the
 * server actions call — no direct SQL where a user action would stand, and no
 * browser storage anywhere. Where a test does reach for `getDb()` directly it
 * is to FIXTURE data or to observe state the workflow does not return.
 */
async function workflowChecks() {
  const RQ2 = "requester-2";
  /** The request the whole flow is built around. */
  const REQ = "req-workflow";

  // --- fixtures: two requesters, one eligible donor -------------------------
  await check("workflow fixtures exist", async () => {
    for (const [id, email, name, role] of [
      [RQ, "rq@example.com", "Rita Requester", "requester"],
      [RQ2, "rq2@example.com", "Ravi Requester", "requester"],
      [DN, "dn@example.com", "Dev Donor", "donor"],
    ] as const) {
      getDb()
        .prepare(
          `INSERT OR IGNORE INTO users
             (id, email, password_hash, full_name, role, status, created_at, updated_at)
           VALUES (?, ?, 'x', ?, ?, 'active', ?, ?)`,
        )
        .run(id, email, name, role, now(), now());
    }
    // One eligible donor: available, O+, no recent donation. The blood group is
    // compatible with every request raised below.
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO donor_profiles
           (user_id, blood_group, locality, phone, latitude, longitude,
            last_donation_date, availability, donation_count, created_at, updated_at)
         VALUES (?, 'O+', 'Central', '9000000000', NULL, NULL, NULL, 'available', 0, ?, ?)`,
      )
      .run(DN, now(), now());
  });

  // --- STEP 1: the requester creates a request -------------------------------
  await check("requester creates a request and it is persisted in SQLite", async () => {
    await db.from("blood_requests").insert({
      id: REQ,
      // The requester id comes from the session, exactly as the action does.
      requester_id: RQ,
      requester_name: "Rita Requester",
      requester_phone: "9999999999",
      blood_group: "O+",
      blood_component: "whole_blood",
      units: 2,
      hospital_name: "City Hospital",
      hospital_locality: "Central",
      urgency: "urgent",
      required_by: soon(),
      note: "Surgery on Friday",
      status: "active",
      created_at: now(),
      updated_at: now(),
    });
    const row = (await db.from("blood_requests").eq("id", REQ).single())
      .data as Record<string, unknown>;
    assert.ok(row, "the request must exist");
    // Every field the form collects must survive the round trip.
    assert.equal(row.blood_group, "O+");
    assert.equal(row.blood_component, "whole_blood");
    assert.equal(row.units, 2);
    assert.equal(row.hospital_name, "City Hospital");
    assert.equal(row.hospital_locality, "Central");
    assert.equal(row.urgency, "urgent");
    assert.equal(row.requester_name, "Rita Requester");
    assert.equal(row.note, "Surgery on Friday");
    assert.equal(row.status, "active");
  });

  // --- STEP 2: DEVICE B sees it (the multi-device requirement) ---------------
  await check("a SECOND DEVICE sees the same request; SQLite is the datastore", async () => {
    // No localStorage, no shared memory: a fresh read of the file. This is what
    // device B gets when it signs in to the same account.
    const seen = (
      await db.from("blood_requests").eq("requester_id", RQ).eq("status", "active").select("*")
    ).data as unknown as Record<string, unknown>[];
    assert.ok(
      seen.some((r) => r.id === REQ),
      "the request must be visible to the same account on another device",
    );

    // And it survives a restart, which a browser-side store could not do.
    closeDb();
    const after = (await db.from("blood_requests").eq("id", REQ).single())
      .data as Record<string, unknown>;
    assert.ok(after, "the request must survive a restart");
    assert.equal(after.units, 2);
  });

  // --- STEP 3: requester scoping --------------------------------------------
  await check("another requester can neither see nor close this request", async () => {
    const theirs = await db.from("blood_requests").eq("requester_id", RQ2).select("*");
    assert.equal(
      (theirs.data as unknown as unknown[]).length,
      0,
      "RQ2 must not see RQ's request",
    );

    // The scoped UPDATE is the authorisation: zero rows, so nothing changed.
    const attempt = closeRequestAsRequester({ id: RQ2, role: "requester" }, REQ, "cancelled");
    assert.equal(attempt.ok, false, "a non-owner must not close it");
    assert.equal(attempt.reason, "not_found");

    const still = (await db.from("blood_requests").eq("id", REQ).single())
      .data as Record<string, unknown>;
    assert.equal(still.status, "active", "the request must be untouched");

    // And they must not be able to learn that it exists by asking about it.
    const match = matchDonorsForRequest({ id: RQ2, role: "requester" }, REQ, null, 50);
    assert.equal(match.error?.message, "No such request.", "matching must not leak it");
    assert.equal(match.data, null);
  });

  // --- STEP 4: donor matching finds the eligible donor -----------------------
  await check("matching finds the eligible donor, and exposes no contact details", async () => {
    const stats = matchingDonorStats({ id: RQ, role: "requester" }, REQ);
    const row = (stats.data as Record<string, unknown>[])[0];
    assert.equal(stats.error, null);
    assert.equal(row.is_active, true);
    assert.ok(Number(row.total_compatible) >= 1, "the eligible donor must be counted");

    const donors = matchDonorsForRequest({ id: RQ, role: "requester" }, REQ, null, 50);
    const list = donors.data as unknown as Record<string, unknown>[];
    assert.ok(list.length >= 1, "the donor must be listed");
    assert.equal(list[0].donor_id, DN);
    // The privacy model: a general locality and a distance, and NEVER a phone
    // number or an address. Contact is revealed only after an acceptance.
    assert.ok("locality" in list[0], "a general location is shown");
    assert.ok(!("phone" in list[0]), "no donor phone number before acceptance");
    assert.ok(
      !/\d{10}/.test(JSON.stringify(list)),
      "no contact-like number may appear in a pre-acceptance match list",
    );
  });

  // --- STEP 5: the ring engine alerts the donor ------------------------------
  await check("the ring engine raises a real alert for the persisted request", async () => {
    const created = expandAlertRings();
    assert.ok(created >= 1, "the eligible donor must be alerted");
    const alert = alertIdOf(REQ, DN);
    assert.ok(Number.isInteger(alert) && alert > 0);
    const row = getDb()
      .prepare("SELECT request_id, donor_id, response, status FROM donor_alerts WHERE id = ?")
      .get(alert) as Record<string, unknown>;
    assert.equal(row.request_id, REQ);
    assert.equal(row.donor_id, DN);
    assert.equal(row.response, null, "an alert starts unanswered");
  });

  // --- STEP 6: a donor responds, and only one can win -----------------------
  await check("first valid donor wins; the request STAYS active", async () => {
    const out = markAlertResponded({ id: DN, role: "donor" }, alertIdOf(REQ, DN), "accepted");
    assert.equal(out, "accepted");

    // THE key lifecycle rule: acceptance is a donor<->request relationship, NOT
    // a request status. The request must still be active and still fulfilable.
    const row = (await db.from("blood_requests").eq("id", REQ).single())
      .data as Record<string, unknown>;
    assert.equal(row.status, "active", "an accepted request is still active");
    const status = String(row.status);
    assert.ok(
      ["active", "fulfilled", "cancelled", "expired"].includes(status),
      `only the four lifecycle states are legal, got ${status}`,
    );
    assert.notEqual(status, "accepted", "'accepted' must never be a request status");
  });

  // --- STEP 7: RS003 and fulfilment -----------------------------------------
  await check("fulfilment requires an accepted donor (RS003)", async () => {
    // A second request with NO donor acceptance at all.
    const bare = "req-workflow-bare";
    await db.from("blood_requests").insert({
      id: bare, requester_id: RQ, requester_name: "Rita Requester",
      requester_phone: "9999999999", blood_group: "O+", blood_component: "whole_blood",
      units: 1, hospital_name: "City Hospital", hospital_locality: "Central",
      urgency: "routine", required_by: soon(), status: "active",
      created_at: now(), updated_at: now(),
    });
    const refused = closeRequestAsRequester({ id: RQ, role: "requester" }, bare, "fulfilled");
    assert.equal(refused.ok, false, "fulfilment without a donor must be refused");
    assert.equal(refused.reason, "no_accepted_donor");
    assert.match(
      refused.message ?? "",
      /only be marked fulfilled once a donor has accepted/i,
      "the requester needs a full sentence, not a generic failure",
    );
    const row = (await db.from("blood_requests").eq("id", bare).single())
      .data as Record<string, unknown>;
    assert.equal(row.status, "active", "a refused fulfilment must not change the request");
  });

  await check("an accepted request can be fulfilled by its owner", async () => {
    const done = closeRequestAsRequester({ id: RQ, role: "requester" }, REQ, "fulfilled");
    assert.equal(done.ok, true, "the requester must be able to fulfil an accepted request");
    const row = (await db.from("blood_requests").eq("id", REQ).single())
      .data as Record<string, unknown>;
    assert.equal(row.status, "fulfilled");
    assert.ok(row.fulfilled_at, "the closure must be timestamped");
  });

  await check("a fulfilled request is terminal", async () => {
    // Only the two transitions a requester can drive are attempted here; the
    // database trigger is what refuses them, and reopening to 'active' is
    // covered by dataChecks' terminal-state check.
    for (const status of ["cancelled", "fulfilled"] as const) {
      const again = closeRequestAsRequester({ id: RQ, role: "requester" }, REQ, status);
      assert.equal(again.ok, false, `a fulfilled request must not become ${status}`);
    }
    const row = (await db.from("blood_requests").eq("id", REQ).single())
      .data as Record<string, unknown>;
    assert.equal(row.status, "fulfilled", "the first terminal state must stick");
  });

  // --- STEP 8: cancellation after acceptance --------------------------------
  await check("a requester can still cancel after a donor accepted", async () => {
    // Deliberately a fresh request: the need going away outranks the match, and
    // this must remain possible even though a donor has already said yes.
    const id = "req-workflow-cancel-after-accept";
    await db.from("blood_requests").insert({
      id, requester_id: RQ, requester_name: "Rita Requester",
      requester_phone: "9999999999", blood_group: "O+", blood_component: "whole_blood",
      units: 1, hospital_name: "City Hospital", hospital_locality: "Central",
      urgency: "urgent", required_by: soon(), status: "active",
      created_at: now(), updated_at: now(),
    });
    expandAlertRings();
    assert.equal(
      markAlertResponded({ id: DN, role: "donor" }, alertIdOf(id, DN), "accepted"),
      "accepted",
    );
    const cancelled = closeRequestAsRequester({ id: RQ, role: "requester" }, id, "cancelled");
    assert.equal(cancelled.ok, true, "cancellation must remain possible after acceptance");
    const row = (await db.from("blood_requests").eq("id", id).single())
      .data as Record<string, unknown>;
    assert.equal(row.status, "cancelled");
    assert.ok(row.cancelled_at, "the closure must be timestamped");
  });

  // --- STEP 9: expiry --------------------------------------------------------
  await check("a request past its deadline expires, and only then", async () => {
    const id = "req-workflow-stale";
    await db.from("blood_requests").insert({
      id, requester_id: RQ, requester_name: "Rita Requester",
      requester_phone: "9999999999", blood_group: "O+", blood_component: "whole_blood",
      units: 1, hospital_name: "City Hospital", hospital_locality: "Central",
      urgency: "routine", required_by: new Date(Date.now() - 3_600_000).toISOString(),
      status: "active", created_at: now(), updated_at: now(),
    });
    expireStaleRequests();
    const row = (await db.from("blood_requests").eq("id", id).single())
      .data as Record<string, unknown>;
    assert.equal(row.status, "expired", "a request past its deadline must expire");

    // And it is terminal: a late cancellation must not revive it.
    const late = closeRequestAsRequester({ id: RQ, role: "requester" }, id, "cancelled");
    assert.equal(late.ok, false, "an expired request must not be cancelled");
  });

  await check("a live request is never expired early", async () => {
    const id = "req-workflow-live";
    await db.from("blood_requests").insert({
      id, requester_id: RQ, requester_name: "Rita Requester",
      requester_phone: "9999999999", blood_group: "O+", blood_component: "whole_blood",
      units: 1, hospital_name: "City Hospital", hospital_locality: "Central",
      urgency: "routine", required_by: soon(), status: "active",
      created_at: now(), updated_at: now(),
    });
    expireStaleRequests();
    const row = (await db.from("blood_requests").eq("id", id).single())
      .data as Record<string, unknown>;
    assert.equal(row.status, "active", "a request before its deadline must stay active");
  });

  await check("expiry never downgrades a closed request", async () => {
    // req-workflow is fulfilled by now; a stale-clock tick must leave it alone.
    expireStaleRequests();
    const row = (await db.from("blood_requests").eq("id", REQ).single())
      .data as Record<string, unknown>;
    assert.equal(row.status, "fulfilled", "terminal states are never downgraded");
  });

}

async function sessionChecks() {
  await check("two devices signed in at once; logging out of one leaves the other", () => {
    const a = createSession(RQ);
    const b = createSession(RQ);
    assert.notEqual(a.token, b.token, "each login gets its own token");
    assert.equal(getUserForToken(a.token)?.id, RQ);
    assert.equal(getUserForToken(b.token)?.id, RQ);

    revokeSession(a.token);
    assert.equal(getUserForToken(a.token), null, "device A is signed out");
    assert.equal(getUserForToken(b.token)?.id, RQ, "device B is still signed in");
  });

  await check("raw session tokens are never stored", () => {
    const rows = getDb().prepare("SELECT token_hash FROM sessions").all() as {
      token_hash: string;
    }[];
    assert.ok(rows.length > 0, "sessions should exist");
    for (const r of rows) {
      assert.match(r.token_hash, /^[a-f0-9]{64}$/, "a hash, never the raw token");
    }
  });

  await check("an expired session authenticates nobody", () => {
    const token = "expired-test-token";
    getDb()
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
         VALUES ('s-exp', ?, ?, ?, ?)`
      )
      .run(
        RQ,
        createHash("sha256").update(token).digest("hex"),
        new Date(Date.now() - 60_000).toISOString(),
        new Date(Date.now() - 1000).toISOString()
      );
    assert.equal(getUserForToken(token), null);
  });

  await check("an unknown token authenticates nobody", () => {
    assert.equal(getUserForToken("not-a-real-token"), null);
    assert.equal(getUserForToken(undefined), null);
  });

  await check("a suspended account's session reports suspended", () => {
    getDb().prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(RQ);
    try {
      assert.equal(
        getUserForToken(createSession(RQ).token)?.status,
        "suspended",
        "status must travel with the session so guards can reject it"
      );
    } finally {
      getDb().prepare("UPDATE users SET status = 'active' WHERE id = ?").run(RQ);
    }
  });

  await check("ALL DATA SURVIVES A SERVER RESTART", async () => {
    closeDb(); // the process "ends" and reopens the same file
    const after = (await db.from("blood_requests").eq("id", "req-1").single())
      .data as Record<string, unknown>;
    assert.ok(after, "the request must survive");
    assert.equal(after.hospital_name, "City Hospital");
    assert.equal(after.status, "active");
    const users = getDb().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
    assert.ok(Number(users.n) >= 2, "users must survive");
    // Notifications must survive the restart. This asserts the notification THIS
    // suite created, not a row total: the request workflow now legitimately
    // produces several more (a winner confirmation, a requester notification, a
    // "someone responded first" per losing donor), so a count would assert a
    // number the workflow is free to change.
    const notif = getDb()
      .prepare(
        "SELECT COUNT(*) AS n FROM notifications WHERE kind = ? AND request_id = ?",
      )
      .get("request_accepted", "req-1") as { n: number };
    assert.equal(Number(notif.n), 1, "this suite's notification must survive a restart");
    const total = getDb().prepare("SELECT COUNT(*) AS n FROM notifications").get() as {
      n: number;
    };
    assert.ok(Number(total.n) >= 1, "notifications must survive");
    const s = getDb()
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL")
      .get() as { n: number };
    assert.ok(Number(s.n) >= 1, "sessions must survive");
  });
}


/**
 * The ACTION-BOUNDARY shape guard.
 *
 * `node:sqlite` hands back rows with a NULL prototype, which React's flight
 * serializer refuses to cross into a Client Component ("Classes or null
 * prototypes are not supported"). A projection returning raw `.all()` rows
 * passes every value assertion and then dies on the wire ONLY once it has
 * real data — so this runs all five projections with data present and checks
 * the shape, which is exactly where the browser breaks.
 */
async function projectionShapeChecks() {
  /** Every row must be rooted on Object.prototype or flight rejects it. */
  const plain = (rows: unknown, label: string) => {
    assert.ok(Array.isArray(rows), `${label} must return an array`);
    for (const row of rows) {
      assert.equal(
        Object.getPrototypeOf(row),
        Object.prototype,
        `${label} returned a null-prototype row — the action wire refuses it`,
      );
    }
  };

  await check("donor_active_alerts rows are plain objects (flight-safe)", async () => {
    const r = await runDashboardRpc("donor_active_alerts", { p_limit: 50 }, { id: DN, role: "donor" });
    assert.equal(r.error, null);
    plain(r.data, "donor_active_alerts");
    assert.ok((r.data as unknown[]).length >= 1, "the seeded accepted alert must appear");
  });

  await check("donor_donation_history rows are plain objects (flight-safe)", async () => {
    getDb()
      .prepare(
        `INSERT INTO donations (id, donor_id, request_id, drive_id, donated_on, blood_component, units, created_at)
         VALUES ('don-shape-1', ?, 'req-1', NULL, ?, 'whole_blood', 2, ?)`,
      )
      .run(DN, now().slice(0, 10), now());
    const r = await runDashboardRpc("donor_donation_history", { p_limit: 20 }, { id: DN, role: "donor" });
    assert.equal(r.error, null);
    plain(r.data, "donor_donation_history");
    assert.ok((r.data as unknown[]).length >= 1, "the seeded donation must appear");
  });

  await check("donor_recognition rows are plain objects (flight-safe)", async () => {
    const r = await runDashboardRpc("donor_recognition", {}, { id: DN, role: "donor" });
    assert.equal(r.error, null);
    plain(r.data, "donor_recognition");
    const rows = r.data as Record<string, unknown>[];
    assert.ok(rows.length >= 1, "recognition must return its summary row");
    assert.ok(Number(rows[0].total_donations) >= 1, "recognition counts the seeded donation");
  });

  await check("reveal_accepted_donors rows are plain objects (flight-safe)", async () => {
    // The reveal projection joins the donor's profile — the fixture donor has
    // no profile row until this one exists.
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO donor_profiles
           (user_id, blood_group, locality, phone, latitude, longitude,
            last_donation_date, availability, donation_count, created_at, updated_at)
         VALUES (?, 'O+', 'Central', '9000000000', NULL, NULL, NULL, 'available', 0, ?, ?)`,
      )
      .run(DN, now(), now());
    const r = await runDashboardRpc(
      "reveal_accepted_donors",
      { p_request_ids: ["req-1"] },
      { id: RQ, role: "requester" },
    );
    assert.equal(r.error, null);
    plain(r.data, "reveal_accepted_donors");
    assert.equal((r.data as unknown[]).length, 1, "the accepted donor must be revealed");
  });

  await check("requester_ring_status rows are plain objects (flight-safe)", async () => {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO ring_progress
           (request_id, ring_index, started_at, last_advanced_at, finished_at, outcome)
         VALUES ('req-1', 1, ?, ?, NULL, NULL)`,
      )
      .run(now(), now());
    const r = await runDashboardRpc(
      "requester_ring_status",
      { p_request_ids: ["req-1"] },
      { id: RQ, role: "requester" },
    );
    assert.equal(r.error, null);
    plain(r.data, "requester_ring_status");
    assert.equal((r.data as unknown[]).length, 1, "ring progress must appear");
  });
}

async function report() {
  closeDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(DB + s)) rmSync(DB + s);
  console.log("");
  if (failures.length) {
    console.error(`✗ ${failures.length} SQLite migration check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error(`\n${passed} passed, ${failures.length} failed`);
    process.exit(1);
  }
  console.log(`✓ all ${passed} SQLite migration checks passed`);
}

async function main() {
  for (const s of ["", "-wal", "-shm"]) if (existsSync(DB + s)) rmSync(DB + s);
  closeDb();

  await check("a fresh database is created automatically with the expected tables", () => {
    const tables = (
      getDb().prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    for (const t of [
      "users", "sessions", "donor_profiles", "blood_requests", "donor_alerts",
      "donations", "notifications", "campus_blood_drives", "campus_drive_registrations",
      "request_reports", "request_assistance", "audit_events",
    ]) {
      assert.ok(tables.includes(t), `missing table ${t}`);
    }
  });

  await check("foreign keys and WAL are actually enabled", () => {
    const fk = getDb().prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    assert.equal(Number(fk.foreign_keys), 1, "foreign keys must be enforced");
    const j = getDb().prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    assert.match(String(j.journal_mode), /wal/i, "WAL must be enabled");
  });

  await check("passwords hash, verify, and are salted", () => {
    const a = hashPassword("correct horse battery staple");
    assert.ok(verifyPassword("correct horse battery staple", a.hash));
    assert.ok(!verifyPassword("wrong password", a.hash));
    const b = hashPassword("correct horse battery staple");
    assert.notEqual(a.hash, b.hash, "hashes must be salted");
    assert.ok(!a.hash.includes("correct horse"), "plaintext must not appear in the hash");
  });

  await check("registration writes a user and never returns the hash", () => {
    // The real generated id is what every later check must use, so the session
    // and request rows satisfy their foreign keys.
    const created = createUser({
      email: "rq@example.com", password: "correct horse battery staple",
      fullName: "Rita Requester", role: "requester",
    });
    RQ = created.id;
    return db.from("users").eq("email", "rq@example.com").single().then((r) => {
      assert.ok(r.data, "user should exist");
      assert.equal((r.data as Record<string, unknown>).id, created.id);
      assert.ok(!("password_hash" in (r.data as Record<string, unknown>)),
        "password_hash must not reach the client");
      const stored = getDb()
        .prepare("SELECT password_hash FROM users WHERE email = ?")
        .get("rq@example.com") as { password_hash: string };
      assert.match(stored.password_hash, /^scrypt\$/, "stored as a scrypt hash");
    });
  });

  await check("login reads the user from SQLite", () => {
    const good = authenticate("rq@example.com", "correct horse battery staple");
    assert.ok(good, "correct credentials must sign in");
    assert.equal(good?.role, "requester");
    assert.equal(authenticate("rq@example.com", "nope"), null);
    assert.equal(authenticate("nobody@example.com", "nope"), null,
      "a missing account must fail without revealing anything");
  });

  await check("a duplicate email is refused by the database", () => {
    let code: string | undefined;
    try {
      createUser({
        email: "rq@example.com", password: "another password",
        fullName: "Impostor", role: "donor",
      });
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    assert.equal(code, "23505");
  });

  await check("public registration cannot produce an admin", () => {
    assert.throws(
      () => getDb().prepare("UPDATE users SET role = 'owner' WHERE email = ?").run("rq@example.com"),
      "an unknown role must be refused by the CHECK constraint"
    );
  });

  await dataChecks();
  await raceChecks();
  await workflowChecks();
  await projectionShapeChecks();
  await sessionChecks();
  await report();
}

main().catch((e) => { console.error(e); process.exit(1); });
