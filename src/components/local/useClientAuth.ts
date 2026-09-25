"use client";

/**
 * Client-side session and role guard.
 *
 * The Server Component guard (`requireRolePage`) cannot be used from a client
 * component, so the data-driven pages ask the SERVER who is signed in. The
 * session lives in an HTTP-only cookie this browser cannot read, so identity is
 * never decided here: it is the same answer the Server Component guards and the
 * middleware get, which is what stops the two from disagreeing.
 *
 * It always settles: an unknown, missing, expired or malformed session resolves
 * to "signed out" rather than throwing, and the caller decides what to render.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { getClientSession } from "@/lib/actions/auth";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AuthenticatedUser } from "@/types";

export type ClientAuth<T> =
  | { status: "checking" }
  | { status: "signed-out" }
  | { status: "wrong-role" }
  | { status: "suspended" }
  | { status: "ready"; user: AuthenticatedUser; data: T };

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
    user: AuthenticatedUser
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
        // Identity comes from the SERVER's session lookup, never from a value
        // this component or a visitor editing storage can supply. The server
        // answers `null` when the session is missing or no longer valid.
        const user = await getClientSession();
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
        // These pages' own payloads still come from the local adapter;
        // migrating them is a separate step that this guard must not block on.
        const supabase = createSupabaseBrowserClient();
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
