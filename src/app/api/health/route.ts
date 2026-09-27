/**
 * PRODUCTION HEALTH CHECK.
 *
 * Answers one question for a load balancer or a platform's health probe: is the
 * server up AND is the database actually usable? A process that is listening but
 * cannot open its database is NOT healthy — it would 500 on every page — and
 * this is the cheapest place to say so.
 *
 * WHAT IT DELIBERATELY DOES NOT RETURN
 *
 * No filesystem path, no database filename, no schema, no table or column name,
 * no version string, no error text, no stack frame, no credential. The failure
 * branch returns a fixed sentence. A health endpoint is unauthenticated and
 * internet-reachable, so anything echoed from the failure would be a disclosure
 * of exactly the things this project must not leak. Operators get the detail
 * from the server log, which is where it belongs.
 */
import { NextResponse } from "next/server";

import { isDatabaseOperational } from "@/lib/server/db";

// Never cached: a stale "ok" would defeat the point of probing it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  if (isDatabaseOperational()) {
    return NextResponse.json(
      { status: "ok" },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }
  // 503 is the "retry me, I am temporarily unable" signal, which is exactly the
  // situation. The reason is deliberately generic.
  return NextResponse.json(
    { status: "unavailable" },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}
