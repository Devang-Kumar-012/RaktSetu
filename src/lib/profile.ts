import { cache } from "react";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LocalUser } from "@/lib/local/store";
import type { AccountRole, Profile } from "@/types";

export interface SessionInfo {
  /** Always true — the app has no external auth dependency. Retained so the
   *  existing guard call sites keep compiling. */
  configured: boolean;
  user: LocalUser | null;
  profile: Profile | null;
}

/**
 * Per-request cached session + profile lookup for Server Components.
 * Never throws — callers can rely on a safe result even when the
 * Supabase project is not configured yet.
 */
export const getSessionInfo = cache(async (): Promise<SessionInfo> => {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    const user = error ? null : data.user;
    if (!user) return { configured: true, user: null, profile: null };

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, status, created_at, updated_at")
      .eq("id", user.id)
      .maybeSingle();

    return { configured: true, user, profile: (profile as Profile) ?? null };
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
 * Signing out is deliberate and is the part that actually matters: without it
 * a suspended user keeps a valid auth cookie, so "log in again" or "reopen an
 * old tab" would restore access. Revoking the session means every subsequent
 * request fails at `auth.getUser()` no matter which route it targets, which is
 * the guarantee the prompt asks for. It is best-effort — if the revoke call
 * fails we still leave the page, and the redirect alone is harmless.
 */
async function endSessionAndReportSuspension(): Promise<never> {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
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
): Promise<{ user: LocalUser; profile: Profile }> {
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
  user: LocalUser;
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
