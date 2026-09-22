import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { APP_NAME } from "@/lib/constants";
import { getSupabaseAnonKey, getSupabaseUrl, isSupabaseConfigured } from "@/lib/env";

const PROTECTED_PREFIXES = ["/dashboard", "/profile"];
const AUTH_PAGES = ["/login", "/register"];

/**
 * Refreshes the Supabase auth session on every request (so sessions stay
 * alive after refresh), guards protected routes, and bounces
 * already-authenticated users away from login/register.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set("x-raktsetu-app", APP_NAME);

  if (!isSupabaseConfigured()) {
    // Supabase not configured yet — allow everything, protect nothing.
    return response;
  }

  let responseWithCookies = response;
  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        responseWithCookies = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          responseWithCookies.cookies.set(name, value, options)
        );
      },
    },
  });

  // getUser() validates the token with the server — safer than getSession().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `next=${encodeURIComponent(`${pathname}${search}`)}`;
    return NextResponse.redirect(url);
  }

  if (AUTH_PAGES.includes(pathname) && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Propagate refreshed auth cookies on ordinary responses.
  return responseWithCookies;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
