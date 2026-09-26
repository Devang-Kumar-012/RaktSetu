"use server";

/**
 * Authentication as a server action — the server boundary for the login flow.
 *
 * WHY THIS EXISTS
 *
 * Sign-in used to run entirely in the browser: the visitor's own JavaScript
 * checked the password against localStorage and then wrote a readable
 * `raktsetu.session` cookie, which the server took at face value. Identity was
 * therefore client-supplied, and anyone could set the cookie to anybody.
 *
 * Now the SERVER owns the session. It verifies the password against the `users`
 * row, stores only the SHA-256 hash of a random token, and hands the browser an
 * HTTP-only cookie it cannot read or forge. The server derives the account from
 * that cookie on every request, so the client submits CREDENTIALS and never an
 * identity — there is no parameter anywhere below that names a user.
 *
 * ERROR VOCABULARY
 *
 * Failures come back as the same short codes Supabase Auth used to produce, so
 * `friendlyAuthError` stays the ONE place raw auth internals become user-facing
 * copy. It never leaks whether an address is registered, and no database
 * message ever reaches a screen.
 */

import { REGISTER_ROLES } from "@/lib/constants";
import {
  authenticate,
  createSession,
  createUser,
  getUserForToken,
  getUserRoles,
  grantRole,
  revokeSession,
  setSessionActiveRole,
  type SessionUser,
} from "@/lib/server/session";
import {
  clearSessionCookie,
  readSessionToken,
  setSessionCookie,
} from "@/lib/server/session-cookie";
import { isValidEmail } from "@/lib/utils";

/**
 * The roles a visitor may choose for themselves.
 *
 * Derived from the same list the register form renders, so the form and the
 * server can never disagree. `admin` is absent by construction.
 */
const PUBLIC_ROLE_VALUES: readonly string[] = REGISTER_ROLES.map(
  (option) => option.value
);

/**
 * Verifies credentials and starts a session.
 *
 * A suspended account is deliberately still allowed a session: the status
 * travels with it (see `getUserForToken`) and every page guard rejects it,
 * ending the session and routing to /account-suspended. One rule, one place.
 */
export async function signInWithPassword(
  email: string,
  password: string
): Promise<{ error: string | null }> {
  const address = typeof email === "string" ? email.trim() : "";
  const secret = typeof password === "string" ? password : "";
  if (!address || !secret) return { error: "Invalid login credentials" };

  const user = authenticate(address, secret);
  if (!user) {
    // Deliberately identical for "no such account" and "wrong password".
    return { error: "Invalid login credentials" };
  }

  const { token, expiresAt } = createSession(user.id);
  await setSessionCookie(token, expiresAt);
  return { error: null };
}

/**
 * Creates an account and signs it in.
 *
 * The submitted role decides only WHICH public role the account gets. It is
 * checked against the allow-list rather than trusted, and anything else —
 * `?role=admin`, a hand-crafted payload, a missing field — lands as
 * "requester", exactly as the old database-side signup trigger did.
 */
export async function signUpNewAccount(input: {
  fullName: unknown;
  email: unknown;
  password: unknown;
  role: unknown;
}): Promise<{ error: string | null; signedIn: boolean }> {
  const fullName = typeof input?.fullName === "string" ? input.fullName.trim() : "";
  const email = typeof input?.email === "string" ? input.email.trim() : "";
  const password = typeof input?.password === "string" ? input.password : "";

  // Server-authoritative validation. The form checks the same things for a
  // better message, but a request that skips the form must not create a
  // one-character password.
  if (!isValidEmail(email)) return { error: "invalid email", signedIn: false };
  if (password.length < 8) {
    return { error: "signup requires a valid password", signedIn: false };
  }
  if (fullName.length < 2) return { error: "signup rejected", signedIn: false };

  const requested = typeof input?.role === "string" ? input.role : "";
  const role = (
    PUBLIC_ROLE_VALUES.includes(requested) ? requested : "requester"
  ) as SessionUser["role"];

  let user: SessionUser;
  try {
    user = createUser({ email, password, fullName, role });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      return { error: "user already registered", signedIn: false };
    }
    console.error("signUpNewAccount failed:", err);
    return { error: "signup unavailable", signedIn: false };
  }

  const { token, expiresAt } = createSession(user.id);
  await setSessionCookie(token, expiresAt);
  return { error: null, signedIn: true };
}

/**
 * Ends THIS device's session: the row is revoked, then the cookie is cleared.
 *
 * Revoking first is what actually matters — it invalidates the token even if

/**
 * Switch which profile this device is ACTING as.
 *
 * One account, many roles, one session. Switching changes the session row's
 * active role and nothing else: the same user stays signed in, with the same
 * email, the same donor profile and the same requests.
 *
 * AUTHORIZATION
 *
 * The requested role arrives from the browser, so it is treated as a CLAIM and
 * checked against the caller's own memberships in `user_roles`. A role the
 * account does not hold — `admin` included, unless the account genuinely has an
 * admin membership — is refused and changes nothing. That check lives in the
 * database layer, so no caller can bypass it.
 *
 * The session is located by the HTTP-only token, so a revoked or expired session
 * resolves to no row and the update matches nothing: switching is impossible
 * without a live session.
 */
export async function switchActiveRole(input: { role: unknown }): Promise<{
  error: string | null;
  role: string | null;
  roles: string[];
}> {
  const token = await readSessionToken();
  const user = getUserForToken(token);
  if (!user) return { error: "Please sign in again.", role: null, roles: [] };

  const requested = typeof input?.role === "string" ? input.role : "";
  if (!setSessionActiveRole(user.id, token ?? "", requested)) {
    // Deliberately does not say whether the role exists or is merely not theirs.
    return {
      error: "That profile is not available on this account.",
      role: user.role,
      roles: user.roles,
    };
  }
  return { error: null, role: requested, roles: user.roles };
}

/**
 * Add a capability to the account that is ALREADY signed in — "Become a donor",
 * "Become a requester".
 *
 * No second account, no second email, no re-authentication: the caller keeps the
 * session it already has, gains one more role, and is switched into it.
 *
 * `admin` is refused structurally rather than cosmetically — it is absent from
 * the allow-list, so it cannot be reached by a crafted payload.
 */
export async function addRoleToCurrentAccount(input: { role: unknown }): Promise<{
  error: string | null;
  role: string | null;
  roles: string[];
}> {
  const token = await readSessionToken();
  const user = getUserForToken(token);
  if (!user) return { error: "Please sign in first.", role: null, roles: [] };
  if (user.status !== "active") {
    return { error: "This account is suspended.", role: null, roles: user.roles };
  }

  const requested = typeof input?.role === "string" ? input.role : "";
  if (!PUBLIC_ROLE_VALUES.includes(requested)) {
    // Includes every attempt to grant admin from the browser.
    return {
      error: "That profile cannot be added to your account.",
      role: null,
      roles: user.roles,
    };
  }

  grantRole(user.id, requested as SessionUser["role"]);
  if (token) setSessionActiveRole(user.id, token, requested);
  return { error: null, role: requested, roles: getUserRoles(user.id) };
}

/**
 * Ends THIS device's session: the row is revoked, then the cookie is cleared.
 *
 * Revoking first is what actually matters — it invalidates the token even if
 * the cookie survives — and clearing the cookie stops the browser presenting a
 * token that can no longer resolve. Other devices are untouched.
 */
export async function signOutCurrentUser(): Promise<{ error: string | null }> {
  try {
    const token = await readSessionToken();
    if (token) revokeSession(token);
  } catch {
    // Best-effort: the cookie is still cleared below.
  } finally {
    await clearSessionCookie();
  }
  return { error: null };
}

/**
 * The authenticated identity for CLIENT components.
 *
 * A Client Component cannot read the HTTP-only cookie and cannot reach the
 * database, so it asks the server with this. It returns identity and role only
 * — never credentials — and `null` when there is no valid session, so a client
 * guard always settles instead of spinning.
 *
 * The cookie is read FIRST, before any database work: during a static
 * prerender that call is what opts the route out of generation, so the build
 * never opens the database file.
 */
export async function getClientSession(): Promise<SessionUser | null> {
  try {
    const token = await readSessionToken();
    return getUserForToken(token) ?? null;
  } catch {
    return null;
  }
}
