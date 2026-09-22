import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AccountRole, Profile } from "@/types";

export interface SessionInfo {
  /** True when Supabase env vars are present and reachable. */
  configured: boolean;
  user: User | null;
  profile: Profile | null;
}

/**
 * Per-request cached session + profile lookup for Server Components.
 * Never throws — callers can rely on a safe result even when the
 * Supabase project is not configured yet.
 */
export const getSessionInfo = cache(async (): Promise<SessionInfo> => {
  if (!isSupabaseConfigured()) {
    return { configured: false, user: null, profile: null };
  }
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
    return { configured: false, user: null, profile: null };
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
 * Server-side role guard for role dashboard/profile pages.
 * Redirects instead of returning — authorization is never left to the UI.
 */
export async function requireRolePage(
  role: AccountRole
): Promise<{ user: User; profile: Profile }> {
  const session = await getSessionInfo();

  if (!session.configured) redirect("/dashboard");
  if (!session.user) redirect("/login");
  if (!session.profile) redirect("/dashboard");
  if (session.profile.role !== role) {
    redirect(`/dashboard/${session.profile.role}`);
  }

  return { user: session.user, profile: session.profile };
}

/** Server-side auth guard for pages any authenticated role may visit. */
export async function requireAuthPage(): Promise<{
  user: User;
  profile: Profile | null;
}> {
  const session = await getSessionInfo();

  if (!session.configured) redirect("/dashboard");
  if (!session.user) redirect("/login");

  return { user: session.user, profile: session.profile };
}
