/**
 * A BRAND-NEW, NEVER-MIGRATED HOSTED DATABASE MUST STILL WORK.
 *
 * This is a regression test for a production bug. On the hosted deployment,
 * registration failed with a generic "an unexpected server error occurred"
 * (REG-…) because the Turso database was EMPTY: the only code that ever ran the
 * migration was `scripts/db-init.ts`, and the only thing that invoked it was the
 * old Dockerfile's `db-init` step. A serverless host has no such step, so
 * nothing migrated the database and the first write raised
 * `SQLITE_ERROR: no such table: users`. It was invisible at build time — an empty
 * database plus a plain INSERT is a RUNTIME error — so the deployment looked
 * healthy while nobody could register.
 *
 * The fix makes schema creation a property of CONNECTING rather than of a start-up
 * hook. This test holds that property to account: it points the REMOTE (libSQL)
 * driver at an empty database and asserts the very first database call already
 * finds a complete, usable schema.
 *
 * The libSQL client also speaks `file:` URLs, so the real remote code path runs
 * here without a network or credentials — nothing is mocked.
 */
import { mkdtempSync, rmSync } from "node:fs";
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

const dir = mkdtempSync(join(tmpdir(), "raktsetu-bootstrap-"));
const file = join(dir, "brand-new.db");

// Select the REMOTE backend, pointed at a database that has never been migrated.
process.env.RAKTSETU_DATABASE_URL = `file:${file}`;
delete process.env.RAKTSETU_DATA_DIR;

async function main() {
  const { getDriver, closeDriver } = await import("../src/lib/server/driver");
  const {
    createUser,
    authenticate,
    createSession,
    getUserForToken,
    getUserRoles,
  } = await import("../src/lib/server/session");

  console.log("\nCold start against an unmigrated hosted database");

  // THE FIRST database call is the one that used to explode.
  const db = await getDriver();
  ok("the first connection succeeds", !!db);
  ok("the remote backend was selected", db.kind === "libsql", db.kind);

  const tables = await db.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table'",
  );
  ok(
    "the schema was created on first contact — no manual db:init",
    tables.length >= 18,
    `found ${tables.length} tables`,
  );
  for (const t of [
    "users", "user_roles", "sessions", "blood_requests",
    "donor_alerts", "notifications",
  ]) {
    ok(`  table ${t} exists`, tables.some((x) => x.name === t));
  }
  const trig = await db.query("SELECT name FROM sqlite_master WHERE type='trigger'");
  ok("the lifecycle triggers were created too", trig.length > 0, `${trig.length}`);

  // The exact stage that failed in production.
  const email = `bootstrap-${Date.now()}@example.com`;
  let user;
  try {
    user = await createUser({
      email,
      password: "a-long-enough-password",
      fullName: "Bootstrap User",
      role: "requester",
    });
  } catch (err) {
    ok("createUser succeeds on a fresh hosted database", false, String(err));
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  }
  ok("createUser succeeds on a fresh hosted database", !!user.id);

  const row = await db.queryOne<{ status: string }>(
    "SELECT status FROM users WHERE id = ?",
    [user.id],
  );
  ok("the users row was actually written", row?.status === "active");

  const roles = await getUserRoles(user.id);
  ok("the role membership was created", roles.length === 1 && roles[0] === "requester", JSON.stringify(roles));

  // The remaining stages of registration, up to (but excluding) the cookie jar,
  // which needs a real Next request context and cannot run in a script.
  const session = await createSession(user.id);
  ok("a session is created", typeof session.token === "string" && session.token.length > 20);
  const resolved = await getUserForToken(session.token);
  ok("the session resolves back to the account", resolved?.id === user.id);
  ok("the active role is the membership, not the request", resolved?.role === "requester");

  // Login, which is the other thing a user does first.
  const signedIn = await authenticate(email, "a-long-enough-password");
  ok("login works", signedIn?.id === user.id);
  ok("a wrong password is still refused", (await authenticate(email, "wrong-password")) === null);

  // A "second cold start" against the same database must see the data: the
  // schema check must not re-migrate over existing rows.
  await closeDriver();
  const again = await getDriver();
  const after = await again.queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM users WHERE email = ?",
    [email],
  );
  ok("the account survives a new connection to the same database", after?.n === 1);
  const stillThere = await again.queryOne<{ id: number }>(
    "SELECT id FROM platform_settings WHERE id = 1",
  );
  ok("the migration marker is intact (fast path is used, not a re-migrate)", !!stillThere);

  await closeDriver();
  rmSync(dir, { recursive: true, force: true });

  console.log(
    failed === 0
      ? `\nall ${passed} schema-bootstrap checks passed\n`
      : `\n${passed} passed, ${failed} failed\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
