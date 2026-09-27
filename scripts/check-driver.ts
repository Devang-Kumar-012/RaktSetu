/**
 * EXERCISE THE REMOTE (libSQL) DRIVER PATH FOR REAL.
 *
 * The production database is hosted, but almost everything about the remote path
 * — `@libsql/client`, the async `execute` calls, the server-side WRITE
 * transaction, the connection memoisation — can be exercised WITHOUT credentials
 * or a network, because the official client also speaks `file:` URLs.
 *
 * Setting `RAKTSETU_DATABASE_URL` to a `file:` URL therefore selects the REMOTE
 * branch of the driver while still running locally. Nothing is stubbed or
 * monkey-patched: this is the same code production runs, minus the network hop.
 * That is the difference between "the remote path type-checks" and "the remote
 * path works".
 *
 * The race-safety case is the important one. "First valid donor wins" is enforced
 * by a UNIQUE constraint applied inside an exclusive write transaction, so this
 * asserts that a losing writer is REJECTED by the database and surfaces as a
 * unique violation the caller can map — not as a silent double-accept.
 */
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const dir = mkdtempSync(join(tmpdir(), "raktsetu-driver-"));
const file = join(dir, "remote.db");

// Select the REMOTE backend. `file:` is a valid libSQL URL, so this exercises the
// real client without a hosted database.
process.env.RAKTSETU_DATABASE_URL = `file:${file}`;
delete process.env.RAKTSETU_DATA_DIR;

// Wrapped rather than using top-level `await`: these scripts are transformed to
// CommonJS, where top-level await is a syntax error.
async function main() {
const { getDriver, driverKind, closeDriver } = await import(
  "../src/lib/server/driver"
);

console.log("\nRemote (libSQL) driver path");

ok("a database URL selects the remote backend", driverKind() === "libsql", driverKind());

const db = await getDriver();
ok("the driver reports itself as libsql", db.kind === "libsql", db.kind);
ok("the client is created lazily but memoised once", (await getDriver()) === db);

// --- schema creation through the remote path --------------------------------
const { initializeDatabase } = await import("../src/lib/server/db");
await initializeDatabase();

const tables = await db.query<{ name: string }>(
  "SELECT name FROM sqlite_master WHERE type='table'",
);
const names = new Set(tables.map((t) => t.name));
ok("the schema is created through the remote path", names.has("users") && names.has("blood_requests"));
ok("all 18 application tables exist", tables.length >= 18, `found ${tables.length}`);
ok("donor_alerts exists (the acceptance table)", names.has("donor_alerts"));
ok("user_roles exists (the membership table)", names.has("user_roles"));
ok("notifications exists", names.has("notifications"));

// The trigger and the uniqueness guarantee the race depends on.
const trig = await db.query<{ name: string }>(
  "SELECT name FROM sqlite_master WHERE type='trigger'",
);
ok("the request-lifecycle triggers are present", trig.length > 0, `found ${trig.length}`);

const idx = await db.query<{ name: string }>(
  "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%one_acceptance%'",
);
ok("the one-acceptance-per-request unique index exists", idx.length > 0);

const INS_USER =
  `INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at)
   VALUES (?, ?, ?, ?, 'requester', 'active', ?, ?)`;

await db.run(INS_USER, ["u1", "driver@example.com", "x", "Driver User", "n1", "n1"]);
const row = await db.queryOne<{ email: string }>(
  "SELECT email FROM users WHERE email = ?",
  ["driver@example.com"],
);
ok("an insert is visible to a subsequent select", row?.email === "driver@example.com");

const upd = await db.run("UPDATE users SET full_name = ? WHERE id = ?", ["Renamed", "u1"]);
ok("run() reports the affected row count", upd.changes === 1, `changes=${upd.changes}`);

// --- the transaction must actually be atomic ---------------------------------
await db.run(INS_USER, ["u2", "rollback@example.com", "x", "Rollback", "n1", "n1"]);

let threw = false;
try {
  await db.transaction(async (tx) => {
    await tx.run(INS_USER, ["u3", "ghost@example.com", "x", "Ghost", "n1", "n1"]);
    throw new Error("deliberate failure");
  });
} catch {
  threw = true;
}
ok("a throwing transaction propagates the error", threw);
const ghost = await db.queryOne("SELECT id FROM users WHERE id = ?", ["u3"]);
ok("a throwing transaction ROLLS BACK — no partial write survives", ghost === undefined);

const committed = await db.transaction(async (tx) => {
  await tx.run(INS_USER, ["u4", "committed@example.com", "x", "Committed", "n1", "n1"]);
  return "done";
});
ok("a transaction returns the callback's value", committed === "done");
ok(
  "a committed transaction persists its writes",
  (await db.queryOne("SELECT id FROM users WHERE id = ?", ["u4"])) !== undefined,
);

// --- the race guarantee: one winner, one clean refusal -----------------------
await db.run(
  `INSERT INTO blood_requests
     (id, requester_id, requester_name, requester_phone, blood_group, blood_component,
      units, locality, urgency, required_by, status, latitude, longitude, created_at, updated_at)
   VALUES ('req1', 'u1', 'Driver User', '+910000000000', 'O+', 'whole_blood',
           1, 'Pune', 'routine', '2099-01-01T00:00:00.000Z', 'active',
           18.52, 73.85, 'n1', 'n1')`,
);
// Two donor accounts must exist first: `donor_alerts.donor_id` REFERENCES users.
for (const d of ["donorA", "donorB", "donorC"]) {
  await db.run(INS_USER, [d, `${d}@example.com`, "x", d, "n1", "n1"]);
  await db.run(
    `INSERT OR IGNORE INTO user_roles (user_id, role, is_primary, created_at)
     VALUES (?, 'donor', 1, 'n1')`,
    [d],
  );
}

const alert = await db.run(
  `INSERT INTO donor_alerts
     (request_id, donor_id, ring_index, ring_km, due_at, created_at, status, response)
   VALUES ('req1', 'donorA', 0, 5, 'n1', 'n1', 'sent', NULL)`,
);
ok("an alert can be created", alert.changes === 1);

// Two acceptors, serialised by the exclusive write transaction. The second must
// be refused by the one-acceptance-per-request index, and the refusal must be a
// recognisable unique-violation error rather than a silent success.
let winners = 0;
let refusal = "";
for (const donor of ["donorB", "donorC"]) {
  try {
    await db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO donor_alerts
           (request_id, donor_id, ring_index, ring_km, due_at, created_at, status, response)
         VALUES ('req1', ?, 0, 5, 'n1', 'n1', 'responded', 'accepted')`,
        [donor],
      );
      winners++;
    });
  } catch (err) {
    refusal = err instanceof Error ? err.message : String(err);
  }
}
ok("exactly ONE acceptance commits", winners === 1, `committed ${winners}`);
ok(
  "the losing acceptance is refused by the database with a UNIQUE violation",
  /UNIQUE constraint failed/i.test(refusal),
  refusal,
);
const acceptances = await db.query(
  "SELECT donor_id FROM donor_alerts WHERE request_id = 'req1' AND response = 'accepted'",
);
ok("exactly ONE acceptance row exists for the request", acceptances.length === 1, `found ${acceptances.length}`);

// --- connection reuse / cleanup ---------------------------------------------
await closeDriver();
ok("the database file was really created on disk", existsSync(file));

rmSync(dir, { recursive: true, force: true });

console.log(
  failed === 0
    ? `\nall ${passed} remote-driver checks passed\n`
    : `\n${passed} passed, ${failed} failed\n`,
);
process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

