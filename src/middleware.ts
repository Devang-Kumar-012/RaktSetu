import { NextResponse, type NextRequest } from "next/server";

import { APP_NAME } from "@/lib/constants";

const PROTECTED_PREFIXES = ["/dashboard", "/request-blood", "/donor", "/admin"];

/**
 * Lightweight middleware. At this stage it only marks protected routes
 * so future auth wiring (Supabase session refresh + redirects) has a
 * single, well-defined place to live.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  // No auth wiring yet — pass through. Future stage will check the
  // Supabase session here and redirect unauthenticated users to /login.
  if (isProtected && process.env.NODE_ENV === "development") {
    // Intentionally no-op; placeholder for auth check.
  }

  const response = NextResponse.next();
  response.headers.set("x-raktsetu-app", APP_NAME);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
