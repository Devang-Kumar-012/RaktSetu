/**
 * Server-side view of the local session.
 *
 * WHY THIS EXISTS
 *
 * The data layer lives in the visitor's browser, so `readSession()` returns null
 * during server rendering — a Server Component can never see localStorage. The
 * route middleware, however, reads the `raktsetu.session` cookie, which the
 * client writes at sign-in. Those two answers disagreed:
 *
 *   /dashboard  → server sees nobody → redirect to /login
 *   /login      → middleware sees the cookie → redirect to /dashboard
 *   …forever, surfaced as the route's loading boundary that never resolves.
 *
 * So the cookie is the ONLY auth state a Server Component can observe, and this
 * module makes it authoritative for "is somebody signed in, and which role
 * dashboard do they belong on".
 *
 * SECURITY, STATED PLAINLY
 *
 * This is a routing signal, NOT a trust boundary. The cookie is written by the
 * visitor's own browser and is readable and forgeable by them — exactly like the
 * localStorage data beside it. Anyone who can edit this cookie can already edit
 * the database, so it grants no capability that was not already there. It exists
 * so the server and the middleware agree, and therefore stop fighting.
 * It deliberately carries NO credential material: no password, no hash, no salt.
 */

import { cookies } from "next/headers";
import type { LocalUser } from "./store";
import type { AccountRole } from "@/types";

export const SESSION_COOKIE = "raktsetu.session";
export const ROUTING_COOKIE = "raktsetu.routing";

/** The non-sensitive fields a Server Component needs to route a request. */
export interface RoutingProfile {
  id: string;
  role: AccountRole;
  status: "active" | "suspended";
  full_name: string;
  email: string;
}

const ROLES: readonly string[] = ["donor", "requester", "volunteer", "admin"];

function isRoutingProfile(value: unknown): value is RoutingProfile {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  if (typeof p.id !== "string" || !p.id) return false;
  if (typeof p.role !== "string" || !ROLES.includes(p.role)) return false;
  if (p.status !== "active" && p.status !== "suspended") return false;
  if (typeof p.full_name !== "string") return false;
  if (typeof p.email !== "string") return false;
  return true;
}

/**
 * The signed-in user as the server can see them, or null.
 *
 * Always resolves. A missing, malformed or mismatched cookie returns null
 * rather than throwing, so no request can hang on authentication.
 */
export async function readServerSession(): Promise<{
  user: LocalUser | null;
  profile: RoutingProfile | null;
}> {
  try {
    const jar = await cookies();
    const sessionId = jar.get(SESSION_COOKIE)?.value;
    if (!sessionId) return { user: null, profile: null };

    const raw = jar.get(ROUTING_COOKIE)?.value;
    if (!raw) {
      // A session cookie with no routing cookie means the browser is mid
      // sign-in, or was written by an older build. Report "signed in, nothing
      // known yet" rather than "nobody", so the page can recover instead of
      // bouncing between /dashboard and /login.
      return { user: { id: sessionId } as LocalUser, profile: null };
    }

    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (!isRoutingProfile(parsed) || parsed.id !== sessionId) {
      // A forged or stale cookie. Treat as signed out so the middleware and the
      // page make the SAME decision, which is what breaks the loop.
      return { user: null, profile: null };
    }
    return { user: { id: parsed.id } as LocalUser, profile: parsed };
  } catch {
    return { user: null, profile: null };
  }
}
