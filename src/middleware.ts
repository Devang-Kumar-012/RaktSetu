import { NextResponse, type NextRequest } from "next/server";

import { APP_NAME } from "@/lib/constants";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/profile",
  "/volunteer",
  "/admin",
  // Private, but previously absent here and therefore reached the page before
  // being redirected. Each page enforces its own guard regardless; listing them
  // here turns that redirect into an early, cheap one and keeps the set honest.
  // `/drives` is deliberately NOT listed — browsing published drives is public.
  "/notifications",
  "/requests",
  "/request-blood",
];

const AUTH_PAGES = ["/login", "/register", "/signup", "/signin", "/create-account"];

/**
 * Route guard.
 *
 * Authentication is a session row in the server database, and the browser holds
 * only an HTTP-only token cookie. This reads that cookie to redirect early and
 * cheaply.
 *
 * The cookie NAME is inlined rather than imported: `src/lib/server/session.ts`
 * owns it, but importing that module would drag the database handle into the
 * edge runtime, which cannot load it. `scripts/check-invariants.ts` pins the two
 * literals together so they cannot drift apart.
 *
 * It authorises nothing on its own. The edge cannot verify a token — every
 * guarded page re-checks the session, the profile, the role and the account
 * status server-side, and those checks are what actually grant access.
 */
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });
  response.headers.set("x-raktsetu-app", APP_NAME);

  const { pathname, search } = request.nextUrl;
  const signedIn = Boolean(request.cookies.get("raktsetu_session")?.value);

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `next=${encodeURIComponent(`${pathname}${search}`)}`;
    return NextResponse.redirect(url);
  }

  if (AUTH_PAGES.includes(pathname) && signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
