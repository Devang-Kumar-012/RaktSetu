/**
 * Server-side data client for Server Components, Server Actions and handlers.
 *
 * Kept async and under the same name so every existing call site — server
 * actions, pages, route handlers — works untouched. See the block below for
 * what it returns now and why.
 */
import { createLocalClient } from "@/lib/local/adapter";
import { createSqlClient } from "@/lib/server/sql-adapter";
import {
  closeRequestAsRequester,
  expandAlertRings,
  markAlertResponded,
  matchDonorsForRequest,
  matchingDonorStats,
  recordDonation,
  type RequestCaller,
  type RequesterClosable,
} from "@/lib/server/sql-requests";
import { getSessionInfo } from "@/lib/profile";

/**
 * The four request-workflow functions, and where each one now executes.
 *
 * These used to be served by the legacy adapter's `rpc`, whose store is
 * `localStorage`. A Server Action has no `localStorage`, so each of them
 * silently resolved against an empty in-memory database: creating a request
 * wrote nothing, a donor's acceptance decided nothing, and cancelling a request
 * closed nothing. They now run against SQLite, with the caller taken from the
 * session cookie rather than from the arguments.
 *
 * A function that is NOT in this table keeps its previous behaviour, so
 * everything outside the request workflow (volunteer, admin, drive reminders)
 * behaves exactly as it did before this migration.
 */
async function requestWorkflowRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: { message: string; code?: string } | null } | null> {
  const { user } = await getSessionInfo();
  if (!user) return { data: null, error: { message: "Please sign in first." } };
  const caller: RequestCaller = { id: user.id, role: user.role };

  switch (name) {
    // --- donor response: first-valid-donor-wins, decided by the database -----
    case "mark_alert_responded": {
      const alertId = Number(args.p_alert_id);
      if (!Number.isSafeInteger(alertId) || alertId <= 0) {
        return { data: "not_found", error: null };
      }
      return {
        data: markAlertResponded(caller, alertId, String(args.p_response ?? "")),
        error: null,
      };
    }

    // --- requester lifecycle -------------------------------------------------
    case "set_request_status": {
      const requestId = String(args.p_request_id ?? "");
      const status = String(args.p_status ?? "");
      if (status !== "fulfilled" && status !== "cancelled") {
        return { data: null, error: { message: "Unsupported request status." } };
      }
      // NOTE the requester id is taken from the SESSION, never from
      // `p_requester_id` — a caller cannot close somebody else's request by
      // naming them.
      const result = closeRequestAsRequester(caller, requestId, status as RequesterClosable);
      if (result.ok) return { data: "ok", error: null };
      // RS003 keeps its SQLSTATE so `fulfillBloodRequest` can surface the full
      // sentence to the requester rather than flattening it into a generic
      // "could not update" failure.
      if (result.reason === "no_accepted_donor") {
        return { data: null, error: { message: result.message ?? "Cannot fulfil.", code: "RS003" } };
      }
      return { data: result.reason, error: null };
    }

    case "close_request_process":
      // The closure now happens inside the lifecycle transaction, so there is
      // nothing left to do here; the request's own state is the contract.
      return { data: "ok", error: null };

    case "record_donation": {
      const result = recordDonation(
        caller,
        String(args.p_request_id ?? ""),
        Number(args.p_units ?? 1),
      );
      return result.ok
        ? { data: { ok: true }, error: null }
        : { data: null, error: { message: result.error } };
    }

    // --- matching ------------------------------------------------------------
    case "match_donors_for_request": {
      const radius = args.p_radius_km;
      return {
        ...matchDonorsForRequest(
          caller,
          String(args.p_request_id ?? ""),
          typeof radius === "number" ? radius : null,
          Number(args.p_limit ?? 50),
        ),
      };
    }
    case "matching_donor_stats":
      return { ...matchingDonorStats(caller, String(args.p_request_id ?? "")) };

    // --- ring engine ---------------------------------------------------------
    case "expand_alert_rings":
      return { data: expandAlertRings(), error: null };

    default:
      return null; // not a request-workflow function
  }
}


/**
 * THE server-side data-access entry point.
 *
 * This one module is the seam: every Server Component and every server action
 * imports `createSupabaseServerClient` from here. Changing what this returns
 * changes where the server-side application reads and writes data, with no
 * caller edits at all.
 *
 * WHY THIS NOW ROUTES TABLE ACCESS TO SQLITE
 *
 * It previously returned the browser adapter (`createLocalClient`), whose store
 * is `localStorage`. A Server Component has no `localStorage`, so every
 * `await supabase.from(...)` on the server resolved to an empty result and the
 * pages rendered their empty state forever, with no error anywhere. That was
 * the real cause of the blank dashboards. Table access now hits the persistent
 * SQLite store instead.
 *
 * WHY `rpc` IS SPLIT IN TWO
 *
 * Table access (`from`) AND the request workflow (`rpc`) both execute against
 * SQLite. The request workflow is the write side of this migration: creating a
 * request, a donor accepting one, and the cancel/fulfil/expiry transitions all
 * used to be served by the browser adapter, whose store is `localStorage` — so on
 * a server they silently resolved against an empty database and changed nothing.
 * `requestWorkflowRpc` runs them against SQLite and takes the caller from the
 * session cookie, never from the arguments.
 *
 * `auth` AND THE NON-REQUEST `rpc` FUNCTIONS ARE STILL DELEGATED —
 * DELIBERATELY
 *
 * `auth` keeps its existing implementation so suspension still revokes the
 * session cookie, and any `rpc` outside the request workflow (volunteer, admin,
 * drive reminders) behaves exactly as it did before. Porting those is a separate,
 * later step; this change is scoped to the request path.
 *
 * SERVER-ONLY BY CONSTRUCTION
 *
 * This module imports the SQLite layer, which uses Node built-ins, so importing
 * it from a client component fails at build time. That is the boundary
 * enforcement: SQLite must never reach the browser.
 */
export async function createSupabaseServerClient() {
  const sql = createSqlClient();
  const legacy = createLocalClient();

  return {
    /** Table reads and writes — now backed by SQLite. */
    from: (table: string) => sql.from(table),
    /**
     * The request workflow executes against SQLite; every other function keeps
     * its previous behaviour, so nothing outside this migration changes.
     */
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      const migrated = await requestWorkflowRpc(name, args);
      if (migrated) return migrated;
      return legacy.rpc(name, args);
    },
    /** Preserved so suspension still revokes the session cookie. */
    auth: legacy.auth,
  };
}

