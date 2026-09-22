import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseConfigured } from "@/lib/env";
import { sanitizeNextPath } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Handles the redirect back from Supabase email links:
 * - signup email confirmation
 * - password recovery links
 * Exchanges the one-time code for a session cookie, then redirects to a
 * sanitized internal path. On failure, sends the user to /login with a
 * generic flag — never an internal error detail.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const next = sanitizeNextPath(searchParams.get("next"), "/");
  const code = searchParams.get("code");

  if (code && isSupabaseConfigured()) {
    try {
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(`${origin}${next}`);
      }
    } catch {
      // fall through to the safe fallback below
    }
  }

  return NextResponse.redirect(`${origin}/login?error=link`);
}
