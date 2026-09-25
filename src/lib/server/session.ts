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
import { getDb } from "./db";
import { hashPassword, verifyPassword } from "./password";

const SESSION_DAYS = 30;
export const SESSION_COOKIE = "raktsetu_session";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface SessionUser {
  id: string;
  email: string;
  full_name: string;
  role: "donor" | "requester" | "volunteer" | "admin";
  status: "active" | "suspended";
}

/** Create a user. Throws code 23505 on a duplicate email. */
export function createUser(input: {
  email: string;
  password: string;
  fullName: string;
  role: SessionUser["role"];
}): SessionUser {
  const { hash } = hashPassword(input.password);
  const now = new Date().toISOString();
  const id = randomUUID();
  try {
    getDb()
      .prepare(
        `INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(id, input.email.toLowerCase().trim(), hash, input.fullName.trim(), input.role, now, now);
  } catch (err) {
    const e = err as { message?: string; code?: string };
    if (/UNIQUE constraint failed/i.test(e.message ?? "")) {
      const dup = Object.assign(new Error("duplicate"), { code: "23505" });
      throw dup;
    }
    throw err;
  }
  return {
    id,
    email: input.email.toLowerCase().trim(),
    full_name: input.fullName.trim(),
    role: input.role,
    status: "active",
  };
}

/** Verify credentials. Returns the user, or null. Never reveals which part failed. */
export function authenticate(email: string, password: string): SessionUser | null {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.toLowerCase().trim()) as
    | (Record<string, unknown> & { password_hash: string })
    | undefined;
  if (!row) {
    // Still burn comparable time so a missing account is not detectable by timing.
    verifyPassword(password, "scrypt$16384$8$1$00$00");
    return null;
  }
  if (!verifyPassword(password, row.password_hash)) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    full_name: String(row.full_name),
    role: row.role as SessionUser["role"],
    status: row.status as SessionUser["status"],
  };
}

/**
 * Start a session. Each call is a separate device, so a user can be signed in
 * on several devices at once.
 */
export function createSession(userId: string): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  getDb()
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(randomUUID(), userId, sha256(token), now.toISOString(), expiresAt.toISOString());
  return { token, expiresAt };
}

/** Resolve a cookie token to its user, honouring expiry and revocation. */
export function getUserForToken(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.role, u.status
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`
    )
    .get(sha256(token), new Date().toISOString()) as
    | (Record<string, unknown> & { role: SessionUser["role"]; status: SessionUser["status"] })
    | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    full_name: String(row.full_name),
    role: row.role,
    status: row.status,
  };
}

/** Revoke ONE session. Other devices are untouched. */
export function revokeSession(token: string): void {
  if (!token) return;
  getDb()
    .prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?")
    .run(new Date().toISOString(), sha256(token));
}
