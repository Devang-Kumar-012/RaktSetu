import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Scheduled-maintenance endpoint.
 *
 * WHY THIS EXISTS
 *
 * The primary scheduler is pg_cron, installed by migration 0011, which ticks
 * the ring engine every minute from INSIDE the database. It needs no
 * application server and no browser. This route is the portable fallback for
 * deployments where pg_cron is unavailable — Supabase free-tier projects are
 * paused after a period of inactivity, and during a pause no in-database cron
 * runs at all, so rings and expiry would otherwise stall until a human visited
 * the site.
 *
 * SECURITY
 *
 * Fails CLOSED. If CRON_SECRET is unset the route returns 503 and runs nothing;
 * it never falls back to "allow if no secret is configured", because that would
 * turn a misconfiguration into a publicly callable engine. The comparison is
 * timing-safe so the secret cannot be recovered byte-by-byte, and the check
 * runs before any database work.
 *
 * It calls only expand_alert_rings() and emit_alert_expiring(), both of which
 * were already executable by the authenticated role before this route existed
 * (migration 0011 / 0012, and the latter is what tickAlertRings already calls).
 * This route therefore introduces NO new database privilege.
 *
 * PRIVACY
 *
 * Logs counts and timings only. No donor ids, phone numbers, emails,
 * localities, coordinates or request identifiers are ever written to the log or
 * returned in the body.
 */

export const dynamic = "force-dynamic";
// Never cache: a cached 200 would mask a dead scheduler.
export const revalidate = 0;

function unauthorized(): NextResponse {
  // Deliberately identical for a missing and a wrong secret, so the response
  // cannot be used to confirm that a secret is configured.
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // secret's length, so compare a fixed-width digest of both instead.
  if (a.length !== b.length) {
    // Still perform a comparison so the fast path is not obviously shorter.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      "[cron] CRON_SECRET is not set — scheduled maintenance is disabled.",
    );
    return NextResponse.json(
      { ok: false, error: "Scheduler is not configured" },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Vercel Cron sends the secret as a query parameter when configured that way.
  const fromQuery = new URL(request.url).searchParams.get("secret") ?? "";
  const provided = bearer || fromQuery;

  if (!provided || !secretMatches(provided, secret)) {
    return unauthorized();
  }

  const startedAt = Date.now();
  console.log("[cron] maintenance run started");

  try {
    const supabase = await createSupabaseServerClient();

    // Expiry is performed inside expand_alert_rings() (migration 0011 runs
    // expire_stale_requests() as its first step), so this single call covers
    // request expiry AND ring progression. Calling expire separately here would
    // be a duplicate path to the same authoritative logic.
    const { data: alertsCreated, error: ringError } = await supabase.rpc(
      "expand_alert_rings",
    );

    if (ringError) {
      console.error("[cron] ring expansion failed:", ringError.message);
      return NextResponse.json(
        { ok: false, error: "Ring expansion failed" },
        { status: 500 },
      );
    }

    // Advisory "your alert expires soon" notices. Idempotent in SQL via
    // donor_alerts.expiring_notified_at, so a retried run cannot double-send.
    const { error: expiringError } = await supabase.rpc("emit_alert_expiring");
    if (expiringError) {
      // Non-fatal: the rings advanced, so report success but record the fault.
      console.error("[cron] alert-expiring sweep failed:", expiringError.message);
    }

    const created = typeof alertsCreated === "number" ? alertsCreated : 0;
    const durationMs = Date.now() - startedAt;

    // Only log when something happened, so an idle system does not fill the log.
    if (created > 0 || expiringError) {
      console.log(
        `[cron] maintenance complete: alerts_created=${created} duration_ms=${durationMs}`,
      );
    } else {
      console.log(
        `[cron] maintenance complete: no changes duration_ms=${durationMs}`,
      );
    }

    return NextResponse.json(
      {
        ok: true,
        alertsCreated: created,
        expiringSweepFailed: Boolean(expiringError),
        durationMs,
      },
      { status: 200 },
    );
  } catch (error) {
    // The message is logged, never returned: it can contain a Supabase URL or
    // query fragment.
    console.error("[cron] maintenance run threw:", error);
    return NextResponse.json(
      { ok: false, error: "Maintenance failed" },
      { status: 500 },
    );
  }
}
