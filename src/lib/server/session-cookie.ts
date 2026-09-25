/**
 * The HTTP-only cookie that carries the SQLite session token.
 *
 * WHY THIS EXISTS
 *
 * `./session` owns the session ROWS — create, resolve, revoke — and knows
 * nothing about the transport. This module is the transport: it is the only
 * place that reads or writes the cookie, so there is exactly one definition of
 * its name and one set of flags.
 *
 * The cookie is HTTP-ONLY, which is the whole point of the migration. The old
 * `raktsetu.session` cookie was written by the visitor's own JavaScript and was
 * therefore readable and forgeable by them. This one is set only by the server
 * in a Server Action, is never exposed to JavaScript, and carries an opaque
 * random token whose SHA-256 hash — not the token — is what the database
 * stores. Editing it is useless: the signature is the database lookup.
 *
 * It is also `SameSite=Lax` and `Path=/`, and expires with the session row.
 * `Secure` is derived from the request's own protocol rather than from
 * `process.env`, because the application reads no configuration at all — an
 * invariant asserted across every file in `src/`.
 */

import { cookies, headers } from "next/headers";

import { SESSION_COOKIE } from "./session";

export { SESSION_COOKIE };

/**
 * The session token from the request's cookie, or `undefined`.
 *
 * Always resolves. A missing or unreadable cookie is "nobody signed in", never
 * an exception, so no request can hang on authentication.
 */
export async function readSessionToken(): Promise<string | undefined> {
  try {
    const jar = await cookies();
    return jar.get(SESSION_COOKIE)?.value || undefined;
  } catch {
    // During a static prerender `cookies()` opts the route out of generation.
    // Returning "no token" keeps the caller on its safe, signed-out path.
    return undefined;
  }
}

/** True when the request itself arrived over HTTPS. */
async function requestIsSecure(): Promise<boolean> {
  try {
    const headersList = await headers();
    const proto = (headersList.get("x-forwarded-proto") ?? "").split(",")[0].trim();
    return proto === "https";
  } catch {
    return false;
  }
}

/**
 * Stores the session token. Only the server can call this — `cookies().set()`
 * is legal inside a Server Action or a Route Handler, and nowhere else.
 */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await requestIsSecure(),
    path: "/",
    expires: expiresAt,
  });
}

/** Removes the cookie. The session row is revoked separately. */
export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: await requestIsSecure(),
    path: "/",
    maxAge: 0,
  });
}
