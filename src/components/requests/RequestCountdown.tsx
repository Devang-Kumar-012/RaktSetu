"use client";

import { useEffect, useState } from "react";

import { describeGap } from "@/lib/utils";

/**
 * Live "time left until the required-by moment" text for an ACTIVE request.
 *
 * The server passes a pre-computed `fallback` string, which is what the
 * first paint shows — so the HTML is identical on the server and in the
 * browser (no hydration mismatch, no layout shift). A timer then keeps it
 * accurate every 30 seconds without ever crossing a request boundary.
 */
export function RequestCountdown({
  deadlineIso,
  fallback,
}: {
  deadlineIso: string;
  fallback: string;
}) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const deadline = new Date(deadlineIso).getTime();
    if (Number.isNaN(deadline)) return;
    const tick = () => setLabel(describeGap(deadline - Date.now()));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [deadlineIso]);

  return <span suppressHydrationWarning>{label ?? fallback}</span>;
}
