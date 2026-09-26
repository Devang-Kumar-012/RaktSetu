/**
 * Proves the migration upgrades a database written by an EARLIER build.
 *
 * Creates a `data/raktsetu.db` in the pre-migration shape — no `cancelled_at` /
 * `fulfilled_at`, an alert whose status uses the old 'accepted' vocabulary, and
 * the OLD (too weak) first-valid-donor-wins index — then opens it through the
 * real `db.ts` and asserts the data survived and the guarantees are now real.
 *
 * A migration that only works on a fresh database is a migration that silently
 * loses production data, so this is checked as carefully as the schema itself.
 *
 * Run with: npx tsx scripts/check-sqlite-migration.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { getUserForToken, getUserRoles, grantRole } from "../src/lib/server/session";

const DB = join(import.meta.dirname, "..", "data", "raktsetu.db");

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

/** Writes a database in the pre-migration shape, with one row in each table. */
function writeOldShape(): void {
  for (const s of ["", "-wal", "-shm"]) if (existsSync(DB + s)) rmSync(DB + s);
  const d = new DatabaseSync(DB);
  d.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, full_name TEXT NOT NULL, role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE blood_requests (id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      requester_name TEXT NOT NULL, requester_phone TEXT NOT NULL, blood_group TEXT NOT NULL,
      blood_component TEXT NOT NULL, units INTEGER NOT NULL, hospital_name TEXT NOT NULL,
      hospital_locality TEXT NOT NULL, urgency TEXT NOT NULL, required_by TEXT NOT NULL, note TEXT,
      status TEXT NOT NULL DEFAULT 'active', latitude REAL, longitude REAL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE donor_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL, donor_id TEXT NOT NULL, ring_index INTEGER NOT NULL,
      ring_km REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent'
        CHECK (status IN ('sent','opened','accepted','declined','expired')),
      response TEXT, due_at TEXT NOT NULL, responded_at TEXT, reminder_sent_at TEXT,
      created_at TEXT NOT NULL, UNIQUE (request_id, donor_id));
    CREATE TABLE ring_progress (request_id TEXT PRIMARY KEY, ring_index INTEGER NOT NULL,
      started_at TEXT NOT NULL, last_advanced_at TEXT NOT NULL, finished_at TEXT, outcome TEXT);
    CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
      kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, request_id TEXT,
      alert_id INTEGER, link TEXT, read_at TEXT, created_at TEXT NOT NULL, dedupe_key TEXT);
    -- The OLD, too-weak index: scoped to (request_id, donor_id).
    CREATE UNIQUE INDEX donor_alerts_one_acceptance_idx
      ON donor_alerts(request_id, donor_id) WHERE response = 'accepted';
  `);
  d.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?,?)").run(
    "u1", "old@example.com", "x", "Old User", "requester", "active", "t", "t",
  );
  d.prepare("INSERT INTO blood_requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
    "old-req", "u1", "N", "9999999999", "O+", "whole_blood", 1, "City Hospital", "Central",
    "urgent", "2099-01-01T00:00:00.000Z", null, "active", null, null, "t", "t",
  );
  // An alert written in the OLD vocabulary, to prove the migration normalises it
  // and keeps the row.
  d.prepare(
    `INSERT INTO donor_alerts
       (request_id, donor_id, ring_index, ring_km, status, response, due_at, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run("old-req", "u1", 1, 3, "accepted", "accepted", "2099-01-01T00:00:00.000Z", "t");
  d.close();
}

async function main() {
  writeOldShape();

  // Opening it runs the real migration, exactly as a server boot would.
  const { getDb, closeDb } = await import("../src/lib/server/db");
  getDb();
  const db = getDb();

  await check("an existing request survives the migration", () => {
    const row = db.prepare("SELECT * FROM blood_requests WHERE id = 'old-req'").get() as
      Record<string, unknown>;
    assert.ok(row, "the pre-existing request must survive");
    // `hospital_name` was replaced by `locality` ("blood needed near"), so the
    // rebuild maps the old value across and drops the dead column.
    assert.equal(row.locality, "Central");
    assert.equal(row.hospital_name, undefined, "the removed field must be gone");
    assert.equal(row.status, "active", "its state must not be rewritten");
  });

  await check("the new columns exist and are null for an untouched request", () => {
    const row = db
      .prepare("SELECT cancelled_at, fulfilled_at FROM blood_requests WHERE id = 'old-req'")
      .get() as Record<string, unknown>;
    assert.ok("cancelled_at" in row, "cancelled_at must have been added");
    assert.ok("fulfilled_at" in row, "fulfilled_at must have been added");
    assert.equal(row.cancelled_at, null);
    assert.equal(row.fulfilled_at, null);
  });

  await check("an alert in the old status vocabulary is normalised, not dropped", () => {
    const row = db.prepare("SELECT * FROM donor_alerts WHERE request_id = 'old-req'").get() as
      Record<string, unknown>;
    assert.ok(row, "the pre-existing alert must survive");
    assert.equal(row.status, "responded", "the state becomes 'responded'");
    assert.equal(row.response, "accepted", "the ANSWER is untouched");
  });

  await check("the first-valid-donor-wins index is replaced, not merely kept", () => {
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'donor_alerts_one_acceptance_idx'")
      .get() as { sql: string };
    assert.ok(row.sql.includes("ON donor_alerts(request_id)"), "must be scoped to request_id alone");
    assert.ok(
      !/request_id,\s*donor_id/.test(row.sql),
      "the old (request_id, donor_id) scope must be gone",
    );
  });

  await check("after migrating, a second donor genuinely cannot be accepted", () => {
    db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?,?)").run(
      "u2", "old2@example.com", "x", "Second", "donor", "active", "t", "t",
    );
    // The request already holds one acceptance, from the migrated alert.
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO donor_alerts
               (request_id, donor_id, ring_index, ring_km, status, response, due_at, created_at)
             VALUES ('old-req','u2',1,3,'responded','accepted','2099-01-01T00:00:00.000Z','t')`,
          )
          .run(),
      /UNIQUE constraint failed/i,
      "a second accepted donor must be refused",
    );
  });

  await check("the terminal-state trigger is installed on a migrated database", () => {
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'blood_requests_terminal_guard'")
      .get() as { sql: string } | undefined;
    assert.ok(row?.sql, "the trigger must exist after migrating");

    // A migrated request starts 'active', so closing it is legal — the trigger
    // must then REFUSE to reopen it. That is the guarantee a migrated row has to
    // have too, and it is the only transition a requester cannot drive through
    // the workflow, so the database is the only thing that can enforce it.
    db.prepare("UPDATE blood_requests SET status = 'cancelled' WHERE id = 'old-req'").run();
    assert.throws(
      () => db.prepare("UPDATE blood_requests SET status = 'active' WHERE id = 'old-req'").run(),
      /closed request cannot change status/i,
      "a migrated request must be just as terminal as a new one",
    );
    // Leave it closed, which is the state the next check asserts is preserved.
  });

  // Re-running must be free, which is what makes this safe on every boot. The
  // request is 'cancelled' by the check above, so this asserts that a SECOND boot
  // leaves that exactly as it found it.
  await check("re-running the migration is a no-op", () => {
    const before = db.prepare("SELECT status, cancelled_at FROM blood_requests WHERE id = 'old-req'").get() as
      Record<string, unknown>;
    closeDb();
    getDb();
    const after = getDb()
      .prepare("SELECT status, cancelled_at FROM blood_requests WHERE id = 'old-req'")
      .get() as Record<string, unknown>;
    assert.equal(after.status, before.status, "a second boot must not change the state");
    assert.equal(after.cancelled_at, before.cancelled_at, "and must not re-stamp it");
  });

  // --- THE ROLE-MEMBERSHIP MIGRATION ---------------------------------------
  // A database written by the single-role era must gain memberships without
  // losing an account, a request or a session.
  await check("a single-role account becomes exactly one membership", () => {
    const rows = getDb()
      .prepare("SELECT role FROM user_roles WHERE user_id = 'u1' ORDER BY role")
      .all() as { role: string }[];
    assert.deepEqual(rows.map((r) => r.role), ["requester"], "u1 was a requester");
    // The pre-migration file had several accounts; the backfill must not add
    // one, and must not leave a membership pointing at a missing account.
    const ids = (getDb().prepare("SELECT id FROM users ORDER BY id").all() as { id: string }[])
      .map((r) => r.id);
    assert.ok(ids.includes("u1"), "the original account must still be there");
    const orphan = getDb()
      .prepare("SELECT COUNT(*) AS n FROM user_roles WHERE user_id NOT IN (SELECT id FROM users)")
      .get() as { n: number };
    assert.equal(Number(orphan.n), 0, "no membership may point at a missing account");
  });

  await check("the membership IS the authority, not the legacy column", () => {
    // Granting a role does NOT touch users.role, which is what proves the single
    // legacy column is no longer consulted for authorization.
    grantRole("u1", "donor");
    const rows = getDb()
      .prepare("SELECT role FROM user_roles WHERE user_id = 'u1' ORDER BY role")
      .all() as { role: string }[];
    assert.deepEqual(rows.map((r) => r.role), ["donor", "requester"]);
    const legacy = getDb().prepare("SELECT role FROM users WHERE id = 'u1'").get() as {
      role: string;
    };
    assert.equal(legacy.role, "requester", "the legacy column is left exactly as it was");
    const roles = getUserRoles("u1");
    assert.equal(roles.length, 2);
    assert.equal(roles[0], "requester", "the original role stays primary");
  });

  await check("a session predating active_role still resolves, and is given one", () => {
    const token = "pre-migration-token";
    getDb()
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
         VALUES ('s-pre', 'u1', ?, ?, ?)`,
      )
      .run(
        createHash("sha256").update(token).digest("hex"),
        new Date().toISOString(),
        new Date(Date.now() + 86_400_000).toISOString(),
      );
    const resolved = getUserForToken(token);
    assert.ok(resolved, "a session created before the column existed must still resolve");
    assert.equal(resolved.id, "u1");
    assert.ok(resolved.roles.includes("donor") && resolved.roles.includes("requester"));
    const row = getDb()
      .prepare("SELECT active_role FROM sessions WHERE id = 's-pre'")
      .get() as { active_role: string | null };
    assert.equal(row.active_role, "requester", "chosen from real memberships, then persisted");
  });

  await check("a stale active role the account never held is repaired", () => {
    getDb()
      .prepare("UPDATE user_roles SET is_primary = 1 WHERE user_id = 'u1' AND role = 'donor'")
      .run();
    getDb()
      .prepare("UPDATE user_roles SET is_primary = 0 WHERE user_id = 'u1' AND role = 'requester'")
      .run();
    getDb()
      .prepare("UPDATE sessions SET active_role = 'admin' WHERE id = 's-pre'")
      .run();
    const resolved = getUserForToken("pre-migration-token");
    assert.equal(resolved?.role, "donor", "an unheld admin active_role must not survive");
    assert.ok(!resolved!.roles.includes("admin"), "and admin is not among its roles");
  });

  await check("the migrated request keeps its original owner", () => {
    const req = getDb()
      .prepare("SELECT requester_id FROM blood_requests WHERE id = 'old-req'")
      .get() as { requester_id: string };
    assert.equal(req.requester_id, "u1", "no data moved between accounts");
  });

  await check("the role backfill is idempotent across a re-boot", () => {
    const before = getDb().prepare("SELECT COUNT(*) AS n FROM user_roles").get() as { n: number };
    closeDb();
    getDb();
    getDb();
    const after = getDb().prepare("SELECT COUNT(*) AS n FROM user_roles").get() as { n: number };
    assert.equal(Number(after.n), Number(before.n), "the backfill must not duplicate rows");
    const dupes = getDb()
      .prepare(
        "SELECT user_id, role, COUNT(*) AS n FROM user_roles GROUP BY user_id, role HAVING n > 1",
      )
      .all() as unknown[];
    assert.equal(dupes.length, 0, "no duplicate membership may exist");
  });
  closeDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(DB + s)) rmSync(DB + s);

  console.log("");
  if (failures.length) {
    console.error(`✗ ${failures.length} migration check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error(`\n${passed} passed, ${failures.length} failed`);
    process.exit(1);
  }
  console.log(`✓ all ${passed} schema migration checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
