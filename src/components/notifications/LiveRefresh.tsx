"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Invisible live-refresh mount — the ONE real-time mechanism shared by the
 * notification centre and the requester pages. It rides the EXISTING
 * `notifications` table: every lifecycle event that matters (a donor
 * accepts, a request is fulfilled / cancelled / expired, the ring process
 * ends) already inserts a notification row via SECURITY DEFINER emitters
 * (migrations 0011/0012), and the caller's own rows are visible under RLS.
 *
 * Refresh triggers:
 *  - window focus / visibility change (always available);
 *  - best-effort Supabase Realtime INSERT on `notifications` — if realtime
 *    is unavailable the page still refreshes on focus, and the server-
 *    rendered data is always authoritative. No second real-time system.
 */
export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    try {
      const supabase = createSupabaseBrowserClient();
      const channel = supabase
        .channel("notifications-live")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications" },
          () => {
            if (!cancelled) router.refresh();
          }
        )
        .subscribe();
      cleanup = () => {
        void supabase.removeChannel(channel);
      };
    } catch {
      // Realtime unavailable → focus/visibility refresh still covers us.
    }
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [router]);

  return null;
}
