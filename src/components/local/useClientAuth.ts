"use client";

/**
 * Client-side session and role guard.
 *
 * The Server Component guard (`requireRolePage`) cannot be used from a client
 * component, and the data-driven pages must now run on the client because the
 * data lives in the visitor's localStorage. This is the client counterpart.
 *
 * It always settles: an unknown, missing or malformed session resolves to
 * "signed out" rather than throwing, and the caller decides what to render.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { LocalUser } from "@/lib/local/store";

export type ClientAuth<T> =
  | { status: "checking" }
  | { status: "signed-out" }
  | { status: "wrong-role" }
  | { status: "suspended" }
  | { status: "ready"; user: LocalUser; data: T };

/**
 * Resolves the signed-in user, requiring `role`.
 *
 * `load` only runs once the user is confirmed signed in AND holding that role,
 * so a component never queries data it is not entitled to see.
 */
export function useClientAuth<T>(
  role: string,
  load: (
    supabase: ReturnType<typeof createSupabaseBrowserClient>,
    user: LocalUser
  ) => Promise<T>,
  nextPath: string,
): ClientAuth<T> & { reload: () => void } {
  const router = useRouter();
  const [state, setState] = useState<ClientAuth<T>>({ status: "checking" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ status: "checking" });

    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase.auth.getUser();
        const user = data.user;
        if (!live) return;
        if (!user) {
          // No session: send the visitor to sign in, remembering where they
          // were headed.
          router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
          setState({ status: "signed-out" });
          return;
        }
        if (user.role !== role) {
          router.replace(`/dashboard/${user.role}`);
          setState({ status: "wrong-role" });
          return;
        }
        if (user.status !== "active") {
          router.replace("/account-suspended");
          setState({ status: "suspended" });
          return;
        }
        const loaded = await load(supabase, user);
        if (live) setState({ status: "ready", user, data: loaded });
      } catch {
        // Never leave the page stuck on a spinner: an unexpected failure lands
        // on the sign-in screen rather than an endless loader.
        if (!live) return;
        router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
        setState({ status: "signed-out" });
      }
    })();

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, nextPath, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}
