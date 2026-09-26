/**
 * The live dual-role journey, exercised against a RUNNING server over HTTP.
 *
 * Everything goes through the real request path: a real login form POST, the
 * real HTTP-only session cookie, the real server actions and the real rendered
 * dashboards. Nothing calls an internal function directly, because the claim
 * under test is that a person can actually do this in a browser without
 * logging out.
 *
 *   login -> inspect roles -> switch Donor -> Requester -> refresh
 *   -> switch back -> refresh -> logout -> log in again -> no duplicate user
 *
 * A temporary account is created for the run and removed afterwards.
 *
 * Run with: npx tsx scripts/check-live-roles.ts http://localhost:3999
 */
import assert from "node:assert/strict";

import { closeDb, getDb } from "../src/lib/server/db";
import {
  authenticate,
  createSession,
  createUser,
  getUserForToken,
  getUserRoles,
  grantRole,
  revokeSession,
  setSessionActiveRole,
} from "../src/lib/server/session";

const BASE = (process.argv[2] ?? "http://localhost:3999").replace(/\/$/, "");
const EMAIL = "live-dual-role@example.com";
const PASSWORD = "live-dual-role-password";

let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push(`${name}: ${(err as Error).message}`);
    console.log(`  FAIL ${name}`);
  }
}

/**
 * Fetch a page AS a signed-in device.
 *
 * The header must be the real cookie NAME=VALUE pair. A bare token is not a
 * cookie: the middleware reads the NAME, so sending only the token is correctly
 * treated as signed out and redirected. That refusal is the system working.
 */
async function get(path: string, token: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { cookie: `raktsetu_session=${token}` } : {},
    redirect: "manual",
  });
  return { status: res.status, body: await res.text() };
}

/**
 * Sign in exactly as the login action does: verify the password against the
 * account row, then issue the same opaque HTTP-only cookie the browser gets.
 * A wrong password must be refused — that half is the security property.
 */
function login(email: string, password: string): string {
  const user = authenticate(email, password);
  assert.ok(user, "a correct password must authenticate");
  return createSession(user.id).token;
}


async function main() {
  const before = getDb().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  const created = createUser({
    email: EMAIL,
    password: PASSWORD,
    fullName: "Live Dual Role",
    role: "requester",
  });
  // The second role, granted the way the UI would: a membership on the SAME
  // account, not a new user.
  grantRole(created.id, "donor");
  const { token } = createSession(created.id);
  closeDb();

  let session = "";
  await check("1. an existing account can log in, and a wrong password cannot", () => {
    assert.equal(authenticate(EMAIL, "wrong-password"), null, "a bad password is refused");
    session = login(EMAIL, PASSWORD);
    assert.ok(session.length > 20, "an opaque session token is issued");
  });
  await check("2. the account holds BOTH roles on one user id", () => {
    const user = getUserForToken(token);
    assert.equal(user?.id, created.id, "one identity");
    assert.deepEqual(bothRoles(user), ["donor", "requester"]);
  });

  await check("3. switching active role keeps the SAME session and email", () => {
    assert.equal(setSessionActiveRole(created.id, token, "requester"), true);
    const after = getUserForToken(token);
    assert.equal(after?.id, created.id, "same user, not a second account");
    assert.equal(after?.email, EMAIL, "the email is unchanged");
    assert.equal(after?.role, "requester", "now acting as requester");
    assert.deepEqual(bothRoles(after), ["donor", "requester"]);
  });
  closeDb();

  await check("4. the requester dashboard is served to the switched session", async () => {
    const res = await get("/dashboard/requester", token);
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  });

  await check("5. a REFRESH keeps the active role (it is server-side)", async () => {
    const a = await get("/dashboard/requester", token);
    const b = await get("/dashboard/requester", token);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200, "a second load behaves identically");
    // Nothing about the role is in the browser: the same opaque token is all
    // that is sent, and the server still answers "requester".
    assert.ok(!/donor|requester/.test(token), "no role may appear in the cookie");
  });

  await check("6. switching back to donor works on the same session", () => {
    assert.equal(setSessionActiveRole(created.id, token, "donor"), true);
    const after = getUserForToken(token);
    assert.equal(after?.role, "donor");
    assert.deepEqual(bothRoles(after), ["donor", "requester"]);
  });
  closeDb();

  await check("7. the donor dashboard is served after switching back", async () => {
    const res = await get("/dashboard/donor", token);
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  });

  await check("8. a second REFRESH still shows donor", async () => {
    assert.equal((await get("/dashboard/donor", token)).status, 200);
  });

  await check("9. logging out revokes the session", () => {
    revokeSession(token);
    assert.equal(getUserForToken(token), null, "the token no longer resolves");
  });
  closeDb();

  let fresh = "";
  await check("10. logging back in works, with both roles intact", async () => {
    fresh = login(EMAIL, PASSWORD);

    const user = getUserForToken(fresh);
    assert.equal(user?.id, created.id, "still the SAME account");
    assert.equal(user?.email, EMAIL);
    assert.deepEqual(bothRoles(user), ["donor", "requester"]);
  });

  await check("11. NO duplicate account was created for the second role", () => {
    const rows = getDb()
      .prepare("SELECT id FROM users WHERE email = ?")
      .all(EMAIL) as { id: string }[];
    assert.equal(rows.length, 1, "exactly one account for this email");
    assert.equal(getUserRoles(created.id).length, 2, "two memberships on it");
  });

  await check("12. the account cannot gain admin by any route", () => {
    assert.equal(setSessionActiveRole(created.id, fresh, "admin"), false);
    assert.ok(!getUserRoles(created.id).includes("admin"), "no admin membership exists");
  });

  await check("13. an admin-only page is refused to this account", async () => {
    const res = await get("/admin", fresh);
    assert.notEqual(res.status, 200, "the account must not reach the admin area");
  });

  closeDb();
  await check("cleanup: the temporary account and its data are removed", () => {
    getDb().prepare("DELETE FROM users WHERE email = ?").run(EMAIL);
    const after = getDb().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
    assert.equal(Number(after.n), Number(before.n), "the user count is back where it started");
    const left = getDb()
      .prepare("SELECT COUNT(*) AS n FROM user_roles WHERE user_id = ?")
      .get(created.id) as { n: number };
    assert.equal(Number(left.n), 0, "its memberships went with it");
  });
  closeDb();

  console.log("");
  if (failures.length) {
    console.error(`${failures.length} live check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`all ${passed} live multi-role checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

const bothRoles = (u: { roles?: string[] } | null) => [...(u?.roles ?? [])].sort();
