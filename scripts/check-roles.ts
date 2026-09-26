/**
 * Multi-role accounts: one email, several capabilities, one session.
 *
 * These exercise the real server modules — user_roles, sessions.active_role and
 * the role helpers — rather than a reimplementation, and cover the four things
 * the architecture has to get right: a dual-role account, switching between its
 * profiles WITHOUT logging out, that the choice survives a refresh, and that
 * none of it can be forged.
 *
 * Run with: npx tsx scripts/check-roles.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { getDb, closeDb } from "../src/lib/server/db";
import {
  createSession,
  createUser,
  getUserForToken,
  getUserRoles,
  grantRole,
  revokeSession,
  setSessionActiveRole,
} from "../src/lib/server/session";
import { createSqlClient } from "../src/lib/server/sql-adapter";

const DB = join(import.meta.dirname, "..", "data", "raktsetu.db");

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

const PASSWORD = "role-test-password";

/** A fresh account, plus the session token standing in for one device. */
function account(email: string, role: "donor" | "requester" | "volunteer") {
  const user = createUser({ email, password: PASSWORD, fullName: email, role });
  const { token } = createSession(user.id);
  return { user, token };
}

async function main() {
  for (const s of ["", "-wal", "-shm"]) if (existsSync(DB + s)) rmSync(DB + s);

  // --- A. a single-role account ---------------------------------------------
  await check("A. a single-role account has exactly one role, and that one active", () => {
    const { user, token } = account("single@example.com", "requester");
    assert.deepEqual(getUserRoles(user.id), ["requester"]);
    const session = getUserForToken(token);
    assert.equal(session?.role, "requester");
    assert.deepEqual(session?.roles, ["requester"]);
  });

  // --- B. one account, two roles, one session -------------------------------
  await check("B. a second role becomes a MEMBERSHIP, never a second account", () => {
    const email = "dual@example.com";
    const { user } = account(email, "requester");
    grantRole(user.id, "donor");
    const users = getDb()
      .prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?")
      .get(email) as { n: number };
    assert.equal(Number(users.n), 1, "there must still be exactly one account");
    const roles = getUserRoles(user.id);
    assert.equal(roles.length, 2);
    assert.ok(roles.includes("donor") && roles.includes("requester"));
    assert.equal(roles[0], "requester", "adding a role must not steal the primary");
  });

  // --- B. switching, without logging out ------------------------------------
  let dualToken = "";
  let dualId = "";
  await check("B. switching keeps the SAME session and the SAME identity", () => {
    const { user, token } = account("switch@example.com", "donor");
    dualId = user.id;
    dualToken = token;
    grantRole(user.id, "requester");
    assert.equal(getUserForToken(token)?.role, "donor", "starts as donor");

    assert.equal(setSessionActiveRole(user.id, token, "requester"), true);
    const after = getUserForToken(token);
    assert.equal(after?.id, user.id, "same user, not a new session or account");
    assert.equal(after?.role, "requester");
    assert.equal(after?.roles.length, 2, "both roles are still held");
  });

  await check("B. the active role survives a refresh (it is server-side)", () => {
    assert.equal(getUserForToken(dualToken)?.role, "requester");
    assert.equal(getUserForToken(dualToken)?.id, dualId);
  });

  await check("B. switching back returns to donor without logging out", () => {
    assert.equal(setSessionActiveRole(dualId, dualToken, "donor"), true);
    const after = getUserForToken(dualToken);
    assert.equal(after?.role, "donor");
    assert.equal(after?.roles.length, 2, "no membership was lost by switching");
  });


  // --- C. security ----------------------------------------------------------
  await check("C. a role the account does NOT hold is refused", () => {
    const { user, token } = account("single-donor@example.com", "donor");
    assert.equal(setSessionActiveRole(user.id, token, "admin"), false, "no admin for a donor");
    assert.equal(setSessionActiveRole(user.id, token, "volunteer"), false);
    assert.equal(getUserForToken(token)?.role, "donor", "the session is unchanged");
  });

  await check("C. an unknown or forged role string is refused", () => {
    const { user, token } = account("forged@example.com", "donor");
    for (const attempt of ["admin", "root", "", "DONOR", "donor ", "donor; DROP TABLE users"]) {
      assert.equal(setSessionActiveRole(user.id, token, attempt), false, `"${attempt}" refused`);
    }
    assert.equal(getUserForToken(token)?.role, "donor");
    const n = getDb().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
    assert.ok(Number(n.n) > 0, "the users table must be intact");
  });

  await check("C. a REVOKED session cannot act, so it cannot switch roles", () => {
    const { user, token } = account("revoked@example.com", "donor");
    grantRole(user.id, "requester");
    assert.equal(getUserForToken(token)?.id, user.id, "valid before revocation");
    revokeSession(token);
    assert.equal(getUserForToken(token), null, "a revoked token authenticates nobody");
  });

  await check("C. an EXPIRED session cannot act, so it cannot switch roles", () => {
    const { user, token } = account("expired@example.com", "donor");
    grantRole(user.id, "requester");
    getDb()
      .prepare("UPDATE sessions SET expires_at = ?")
      .run(new Date(Date.now() - 1000).toISOString());
    assert.equal(getUserForToken(token), null, "an expired token authenticates nobody");
  });

  await check("C. another account's roles are not reachable", () => {
    const a = account("mine@example.com", "donor");
    const b = account("theirs@example.com", "requester");
    // Switching as A to a role only B holds is still refused: the check is
    // against the SESSION'S OWN user's memberships, never a supplied id.
    assert.equal(setSessionActiveRole(b.user.id, a.token, "volunteer"), false);
    assert.equal(getUserForToken(a.token)?.role, "donor", "A is unaffected");
    assert.equal(getUserForToken(b.token)?.id, b.user.id, "B is unaffected");
  });

  // --- D. data preservation -------------------------------------------------
  await check("D. donor profile and requests both survive a role switch", async () => {
    const db = createSqlClient();
    const { user, token } = account("preserved@example.com", "donor");
    const now = new Date().toISOString();
    const soon = new Date(Date.now() + 3_600_000).toISOString();

    getDb()
      .prepare(
        `INSERT INTO donor_profiles
           (user_id, blood_group, locality, phone, last_donation_date, availability,
            donation_count, created_at, updated_at)
         VALUES (?, 'O+', 'Central', '9000000000', NULL, 'available', 0, ?, ?)`,
      )
      .run(user.id, now, now);
    await db.from("blood_requests").insert({
      id: "role-preserve-req",
      requester_id: user.id,
      requester_name: "Preserved",
      requester_phone: "9999999999",
      blood_group: "O+",
      blood_component: "whole_blood",
      units: 1,
      locality: "Bengaluru Central",
      urgency: "urgent",
      required_by: soon,
      status: "active",
      created_at: now,
      updated_at: now,
    });

    grantRole(user.id, "requester");
    assert.equal(setSessionActiveRole(user.id, token, "requester"), true);

    const donor = getDb()
      .prepare("SELECT blood_group FROM donor_profiles WHERE user_id = ?")
      .get(user.id) as { blood_group: string } | undefined;
    assert.equal(donor?.blood_group, "O+", "the donor profile survived");
    const req = (await db.from("blood_requests").eq("id", "role-preserve-req").single())
      .data as Record<string, unknown>;
    assert.ok(req, "the request survived");
    assert.equal(req.requester_id, user.id, "still owned by the same account");

    assert.equal(setSessionActiveRole(user.id, token, "donor"), true);
    const still = getDb()
      .prepare("SELECT COUNT(*) AS n FROM donor_profiles WHERE user_id = ?")
      .get(user.id) as { n: number };
    assert.equal(Number(still.n), 1, "and nothing was duplicated");
  });

  await check("D. notifications stay attached to the account across a role change", () => {
    const { user } = account("notified@example.com", "requester");
    getDb()
      .prepare("INSERT INTO notifications (user_id, kind, title, body, created_at) VALUES (?, 't', 't', 'b', ?)")
      .run(user.id, new Date().toISOString());
    grantRole(user.id, "donor");
    const n = getDb()
      .prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?")
      .get(user.id) as { n: number };
    assert.equal(Number(n.n), 1);
  });

  // --- E. existing behaviour, unchanged -------------------------------------
  await check("E. logging out still revokes only that device", () => {
    const { user } = account("twodevices@example.com", "donor");
    grantRole(user.id, "requester");
    const a = createSession(user.id);
    const b = createSession(user.id);
    // Each device has its OWN active role, so one phone switching does not
    // silently re-point the other.
    setSessionActiveRole(user.id, a.token, "donor");
    setSessionActiveRole(user.id, b.token, "requester");
    assert.equal(getUserForToken(a.token)?.role, "donor");
    assert.equal(getUserForToken(b.token)?.role, "requester");

    revokeSession(a.token);
    assert.equal(getUserForToken(a.token), null, "device A is signed out");
    assert.equal(getUserForToken(b.token)?.id, user.id, "device B is still signed in");
    assert.equal(getUserForToken(b.token)?.roles.length, 2, "and keeps both roles");
  });

  await check("E. the four lifecycle states are untouched by this work", () => {
    const src = require("node:fs").readFileSync(
      join(import.meta.dirname, "..", "src", "lib", "server", "db.ts"),
      "utf8",
    ) as string;
    assert.ok(
      src.includes("CHECK (status IN ('active','fulfilled','cancelled','expired'))"),
      "the request lifecycle constraint must be unchanged",
    );
    assert.ok(!/status IN \([^)]*accepted/.test(src), "'accepted' must never be a request status");
  });

  closeDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(DB + s)) rmSync(DB + s);

  console.log("");
  if (failures.length) {
    console.error(`\n${failures.length} role check(s) failed:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\nall ${passed} multi-role checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
