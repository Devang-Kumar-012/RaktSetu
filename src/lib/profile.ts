import { cache } from "react";
import { redirect } from "next/navigation";

import { getUserForToken, revokeSession } from "@/lib/server/session";
import { readSessionToken } from "@/lib/server/session-cookie";
import type { AccountRole, AuthenticatedUser, Profile } from "@/types";

export interface SessionInfo {
  /** Always true — the app has no external auth dependency. Retained so the
   *  existing guard call sites keep compiling. */
  configured: boolean;
  user: AuthenticatedUser | null;
  profile: Profile | null;
}

/**
 * The caller's profile, built from the users row the session already resolved.
 *
 * A second query is deliberately avoided: the session lookup returns every
 * field `Profile` needs, so the profile can never disagree with the identity it
 * belongs to.
 */
function profileOf(user: AuthenticatedUser): Profile {
  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    status: user.status,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

/**
 * Per-request cached session + profile lookup for Server Components.
 *
 * WHERE THE TRUTH LIVES
 *
 * The session is a row in the `sessions` table and the token is an HTTP-only
 * cookie the SERVER set. So the account is whatever the database says it is —
 * not what the browser claims. The client contributes a credential at sign-in
 * and nothing else: there is no user id in any query below.
 *
 * This is the same answer the route middleware reaches, so a page guard and the
 * edge can never disagree about "is somebody signed in" — the disagreement that
 * once produced a /dashboard ⇄ /login redirect loop with a loading boundary
 * that never resolved.
 *
 * A suspended account still gets a session and a profile. Refusing to resolve
 * it here would hide the status from the guards that must act on it; the status
 * travels with the session and `requireRolePage` / `requireAuthPage` end it.
 *
 * Always resolves — every path returns, and the catch returns a safe value, so
 * no request can hang on authentication.
 */
export const getSessionInfo = cache(async (): Promise<SessionInfo> => {
  try {
    // The cookie read comes FIRST, before any database work: during a static
    // prerender this call is what opts the route out of generation, so the
    // build never opens the database file.
    const token = await readSessionToken();
    const user = getUserForToken(token);
    if (!user) return { configured: true, user: null, profile: null };

    return { configured: true, user, profile: profileOf(user) };
  } catch {
    return { configured: true, user: null, profile: null };
  }
});

/**
 * Restrict redirect targets to internal paths only.
 * Blocks protocol-relative ("//evil.com") and traversal tricks.
 */
export function sanitizeNextPath(value: unknown, fallback = "/dashboard"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    return fallback;
  }
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("..")) {
    return fallback;
  }
  return value;
}

/**
 * Ends the session of an account an administrator has suspended, then sends the
 * user to the explanation page.
 *
 * Revoking the row is deliberate and is the part that actually matters: without
 * it a suspended user keeps a token that still resolves, so "log in again" or
 * "reopen an old tab" would restore access. Revocation makes every subsequent
 * request fail at `getUserForToken()` no matter which route it targets, which is
 * the guarantee the guards exist to provide. It is best-effort — if the revoke
 * call fails we still leave the page, and the redirect alone is harmless.
 *
 * The cookie is NOT cleared here: a render pass cannot set cookies. It would not
 * help either — a token whose row is revoked authenticates nobody — and the
 * next sign-in overwrites it. `signOutCurrentUser()` clears cookie and row.
 */
async function endSessionAndReportSuspension(): Promise<never> {
  try {
    const token = await readSessionToken();
    if (token) revokeSession(token);
  } catch {
    // Best-effort: the redirect below is still correct.
  }
  redirect("/account-suspended");
}

/**
 * Server-side role guard for role dashboard/profile pages.
 * Redirects instead of returning — authorization is never left to the UI.
 *
 * A SUSPENDED account is rejected here, not merely hidden in the UI. Reading
 * `status` from the caller's own profile row is server-side, and this runs on
 * every request to every guarded route.
 */
export async function requireRolePage(
  role: AccountRole
): Promise<{ user: AuthenticatedUser; profile: Profile }> {
  const session = await getSessionInfo();

  if (!session.configured) redirect("/dashboard");
  if (!session.user) redirect("/login");
  if (!session.profile) redirect("/dashboard");
  if (session.profile.status !== "active") {
    return endSessionAndReportSuspension();
  }
  if (session.profile.role !== role) {
    redirect(`/dashboard/${session.profile.role}`);
  }

  return { user: session.user, profile: session.profile };
}

/**
 * Server-side auth guard for pages any authenticated role may visit.
 * Applies the same suspension rule as requireRolePage.
 */
export async function requireAuthPage(): Promise<{
  user: AuthenticatedUser;
  profile: Profile;
}> {
  const session = await getSessionInfo();

  if (!session.configured) redirect("/dashboard");
  if (!session.user) redirect("/login");
  if (!session.profile) redirect("/dashboard");
  if (session.profile.status !== "active") {
    return endSessionAndReportSuspension();
  }

  return { user: session.user, profile: session.profile };
}
