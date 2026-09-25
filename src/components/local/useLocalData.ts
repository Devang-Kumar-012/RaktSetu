"use client";

/**
 * Loads data from the LOCAL store in the browser.
 *
 * WHY THIS EXISTS
 *
 * The data layer lives in the visitor's own localStorage. A Server Component
 * runs on the server, where localStorage does not exist, so every `await
 * supabase.from(...)` in a page returned an empty result and the page rendered
 * its empty state FOREVER. `router.refresh()` did not help: it re-renders the
 * same Server Component, which still cannot see the browser's data. That is why
 * the dashboards looked blank rather than merely slow.
 *
 * This hook is the client-side counterpart: it reads the store after mount, and
 * it ALWAYS settles. No path leaves `loading` true forever — success, empty and
 * failure each set a terminal state, and the cleanup prevents a state update
 * after unmount.
 */

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type LocalLoad<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

/**
 * Runs `load` on mount (and whenever `deps` change) and never hangs.
 *
 * `load` receives the local client and must resolve. If it rejects, the error is
 * captured rather than thrown, so one failed query cannot white-screen a page.
 */
export function useLocalData<T>(
  load: (supabase: ReturnType<typeof createSupabaseBrowserClient>) => Promise<T>,
  deps: unknown[] = [],
): { state: LocalLoad<T>; reload: () => void } {
  const [state, setState] = useState<LocalLoad<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });

    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const data = await load(supabase);
        if (live) setState({ status: "ready", data });
      } catch (err) {
        if (!live) return;
        setState({
          status: "error",
          message:
            err instanceof Error && err.message
              ? err.message
              : "Some information could not be loaded. Please try again.",
        });
      }
    })();

    return () => {
      live = false;
    };
    // `load` is deliberately excluded: callers pass an inline closure, which
    // would restart this effect on every render. `deps` is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { state, reload };
}
