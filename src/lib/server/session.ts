/**
 * Server-side sessions — the single authentication source.
 *
 * A login creates a row in `sessions` and hands the browser an opaque random
 * token in an HTTP-only cookie. Only a HASH of that token is stored, so a leaked
 * database cannot be replayed as a login.
 *
 * Because each login gets its own row, several devices can be signed in at once
 * and logging out of one revokes only that device. This is what replaces the
 * old localStorage session, which existed only inside one browser.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { AuthenticatedUser } from "@/types";
import { getDriver } from "./driver";
import { hashPassword, verifyPassword } from "./password";

const SESSION_DAYS = 30;
export const SESSION_COOKIE = "raktsetu_session";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * The authenticated identity.
 *
 * The shape is declared in `@/types` so a CLIENT component can hold the
 * server's answer without importing this module — which owns the database
 * handle. It carries identity, role and timestamps only: no hash, no salt, and
 * no route back to a credential.
 */
export type SessionUser = AuthenticatedUser;

/** The four roles an account can hold. Admin is granted, never chosen. */
const ROLES = ["donor", "requester", "volunteer", "admin"] as const;
type DbRole = (typeof ROLES)[number];

function isRole(value: unknown): value is DbRole {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Every role this account holds, ordered so the answer is deterministic.
 *
 * This is the ONE authoritative source of what an account may do. The order is
 * `is_primary` first, then a fixed role order, so two calls never disagree about
 * what "the first role" is.
 */
export async function getUserRoles(userId: string): Promise<DbRole[]> {
  const db = await getDriver();
  const rows = await db.query<{ role: string }>(
    `SELECT role FROM user_roles
        WHERE user_id = ?
        ORDER BY is_primary DESC,
                 CASE role
                   WHEN 'admin' THEN 0 WHEN 'donor' THEN 1
                   WHEN 'requester' THEN 2 ELSE 3
                 END`,
    [userId],
  );
  const roles = rows.map((r) => r.role).filter(isRole);
  // An account with no membership at all can still sign in; it simply has
  // nothing to do. Never invent a role here.
  return roles;
}

/**
 * Grant this account an additional role.
 *
 * The caller decides WHICH role is allowed to reach this (public registration
 * and the self-service "become a donor" action both refuse `admin`); this
 * function only records a membership that is known to be permitted, and it
 * cannot create an account, change an email, or touch any other user.
 */
export async function grantRole(
  userId: string,
  role: DbRole,
  makePrimary = false,
): Promise<void> {
  const db = await getDriver();
  const now = new Date().toISOString();
  // Both statements are one logical unit: clearing the old primary and writing
  // the new one must not interleave with another request, or an account could
  // momentarily hold two primaries.
  await db.transaction(async (tx) => {
    if (makePrimary) {
      await tx.run("UPDATE user_roles SET is_primary = 0 WHERE user_id = ?", [userId]);
    }
    await tx.run(
      `INSERT OR IGNORE INTO user_roles (user_id, role, is_primary, created_at)
       VALUES (?, ?, ?, ?)`,
      [userId, role, makePrimary ? 1 : 0, now],
    );
  });
}

/**
 * Change which profile THIS device is acting as.
 *
 * Scoped to ONE session row, found by its token hash — the same opaque token the
 * browser holds. Switching a profile on a laptop must not silently re-point the
 * user's phone.
 *
 * Returns false — and changes nothing — when the role is not one the account
 * actually holds, or is not a role at all. That check is the whole point: the
 * requested role arrives from the browser, and the ONLY thing that makes it
 * legitimate is a matching row in `user_roles` for the session's own user.
 */
export async function setSessionActiveRole(
  userId: string,
  token: string,
  role: string,
): Promise<boolean> {
  if (!isRole(role)) return false;
  if (!(await getUserRoles(userId)).includes(role)) return false;
  const db = await getDriver();
  const info = await db.run(
    "UPDATE sessions SET active_role = ? WHERE user_id = ? AND token_hash = ?",
    [role, userId, sha256(token)],
  );
  return info.changes > 0;
}

/** Create a user. Throws code 23505 on a duplicate email. */
export async function createUser(input: {
  email: string;
  password: string;
  fullName: string;
  role: SessionUser["role"];
}): Promise<SessionUser> {
  const { hash } = hashPassword(input.password);
  const now = new Date().toISOString();
  const id = randomUUID();
  const db = await getDriver();
  try {
    await db.run(
      `INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        id,
        input.email.toLowerCase().trim(),
        hash,
        input.fullName.trim(),
        input.role,
        now,
        now,
      ],
    );
  } catch (err) {
    const e = err as { message?: string; code?: string };
    if (/UNIQUE constraint failed/i.test(e.message ?? "")) {
      const dup = Object.assign(new Error("duplicate"), { code: "23505" });
      throw dup;
    }
    throw err;
  }
  // The role the account was created with becomes its membership AND its primary.
  // `users.role` is written once here purely so the legacy column stays coherent
  // for an older binary; it is never read for authorization.
  await grantRole(id, input.role, true);
  return {
    id,
    email: input.email.toLowerCase().trim(),
    full_name: input.fullName.trim(),
    role: input.role,
    roles: [input.role],
    status: "active",
    created_at: now,
    updated_at: now,
  };
}

/** Verify credentials. Returns the user, or null. Never reveals which part failed. */
export async function authenticate(
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const db = await getDriver();
  const row = await db.queryOne<Record<string, unknown> & { password_hash: string }>(
    "SELECT * FROM users WHERE email = ?",
    [email.toLowerCase().trim()],
  );
  if (!row) {
    // Still burn comparable time so a missing account is not detectable by timing.
    verifyPassword(password, "scrypt$16384$8$1$00$00");
    return null;
  }
  if (!verifyPassword(password, row.password_hash)) return null;
  const roles = await getUserRoles(String(row.id));
  return {
    id: String(row.id),
    email: String(row.email),
    full_name: String(row.full_name),
    // A fresh sign-in starts in the account's primary role, or its first
    // membership. Never a role the account does not hold.
    role: (roles[0] ?? "requester") as SessionUser["role"],
    roles,
    status: row.status as SessionUser["status"],
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

/**
 * Start a session. Each call is a separate device, so a user can be signed in
 * on several devices at once.
 */
export async function createSession(
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  const db = await getDriver();
  await db.run(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), userId, sha256(token), now.toISOString(), expiresAt.toISOString()],
  );
  return { token, expiresAt };
}

/**
 * Resolve a cookie token to its user, honouring expiry and revocation.
 *
 * THE ACTIVE ROLE IS RESOLVED HERE, FROM THE DATABASE.
 *
 * The session row's `active_role` is the answer, and it is server state the
 * browser cannot reach — the cookie is an opaque token, so nothing in the request
 * ever names a role. Two fallbacks make an older or odd session safe rather than
 * broken:
 *
 *   - a session whose stored role is not one the account ACTUALLY holds is
 *     repaired to the account's primary role, so a removed (or never granted)
 *     role can never survive as a stale grant;
 *   - a session with no active role at all is given the primary role and the
 *     choice is persisted, so it is stable from then on.
 *
 * Either way the result is a role the account genuinely holds, and the account
 * keeps every membership — this only chooses which one this device is using.
 */
export async function getUserForToken(
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;
  const db = await getDriver();
  const row = await db.queryOne<Record<string, unknown> & {
    active_role: string | null;
    session_id: string;
  }>(
    `SELECT u.id, u.email, u.full_name, u.status,
            u.created_at, u.updated_at, s.id AS session_id, s.active_role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    [sha256(token), new Date().toISOString()],
  );
  if (!row) return null;

  const userId = String(row.id);
  const roles = await getUserRoles(userId);
  const stored = row.active_role;
  const valid = isRole(stored) && roles.includes(stored) ? stored : undefined;
  const active = valid ?? roles[0];

  // No membership at all: authenticated, but with nothing to do. Returning the
  // identity is honest; inventing a role would not be.
  if (!active) {
    return {
      id: userId,
      email: String(row.email),
      full_name: String(row.full_name),
      role: "requester",
      roles: [],
      status: row.status as SessionUser["status"],
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }

  if (!valid) {
    await db.run("UPDATE sessions SET active_role = ? WHERE id = ?", [
      active,
      row.session_id,
    ]);
  }

  return {
    id: userId,
    email: String(row.email),
    full_name: String(row.full_name),
    role: active,
    roles,
    status: row.status as SessionUser["status"],
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}
/** Revoke ONE session. Other devices are untouched. */
export async function revokeSession(token: string): Promise<void> {
  if (!token) return;
  const db = await getDriver();
  await db.run("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?", [
    new Date().toISOString(),
    sha256(token),
  ]);
}

