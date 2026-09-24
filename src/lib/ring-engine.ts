/**
 * Opportunistic server-side tick for the emergency alert-ring engine.
 *
 * The production scheduler is pg_cron (every minute, installed by migration
 * 0011), which runs inside the database and needs neither a browser nor an
 * application server. This helper is the safety net for when pg_cron is not
 * executing — notably while a paused Supabase project runs no database cron at
 * all. It is ticked once per AUTHENTICATED server render (root layout) and from
 * the donor alert action; public page views deliberately do not drive it.
 *
 * It runs in Node only (never the browser), never throws, and is inherently
 * idempotent — the engine's FOR UPDATE SKIP LOCKED + ON CONFLICT DO NOTHING
 * design makes concurrent ticks safe, and ticks inside a ring window are
 * no-ops. It decides nothing itself: all ring logic lives in
 * public.expand_alert_rings() (SQL), with the decision rules mirrored and
 * verified offline in src/lib/alert-rings.ts + scripts/check-rings.ts.
 */
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Runs the ring-engine tick; safe (and cheap) to call on every server request. */
export async function tickAlertRings(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    // Errors are intentionally ignored: if this tick cannot advance the
    // engine, pg_cron or the next opportunistic tick will.
    await supabase.rpc("expand_alert_rings");
    // One "expiring" nudge per open alert (idempotent in SQL via
    // donor_alerts.expiring_notified_at) — migration 0012's emitter.
    await supabase.rpc("emit_alert_expiring");
  } catch {
    // Best-effort only — a ring tick must never break the page being served.
  }
}
