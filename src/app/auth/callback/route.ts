import { NextResponse, type NextRequest } from "next/server";

import { sanitizeNextPath } from "@/lib/profile";

/**
 * Callback target for account links.
 *
 * RaktSetu has no email provider, so there is no one-time code to exchange and
 * no redirect loop to guard against. The route is kept so any bookmarked link
 * lands somewhere sensible: a sanitized internal `next` path, never an open
 * redirect to another origin.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const next = sanitizeNextPath(searchParams.get("next"), "/dashboard");
  return NextResponse.redirect(`${origin}${next}`);
}
