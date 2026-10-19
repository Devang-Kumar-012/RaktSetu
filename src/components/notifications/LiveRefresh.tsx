"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Invisible live-refresh mount — the ONE real-time mechanism shared by the
 * notification centre and the requester pages. It rides the EXISTING
 * `notifications` table: every lifecycle event that matters (a donor
 * accepts, a request is fulfilled / cancelled / expired, the ring process
 * ends) already inserts a notification row via SECURITY DEFINER emitters
 * (migrations 0011/0012), and the caller's own rows are visible under RLS.
 *
 * Refresh trigger: window focus / visibility change. The server-rendered
 * data is always authoritative.
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

  return null;
}
