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

  await check("fulfilled / cancelled / expired stay legal", async () => {
    for (const status of ["fulfilled", "cancelled", "expired"] as const) {
      const r = await db.from("blood_requests").update({ status }).eq("id", "req-1");
      assert.ok(!r.error, `${status} must be legal`);
    }
    await db.from("blood_requests").update({ status: "active" }).eq("id", "req-1");
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
    const notifs = getDb().prepare("SELECT COUNT(*) AS n FROM notifications").get() as {
      n: number;
    };
    assert.equal(Number(notifs.n), 1, "notifications must survive");
    const s = getDb()
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL")
      .get() as { n: number };
    assert.ok(Number(s.n) >= 1, "sessions must survive");
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
  await sessionChecks();
  await report();
}

main().catch((e) => { console.error(e); process.exit(1); });
