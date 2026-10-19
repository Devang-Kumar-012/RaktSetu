/**
 * Browser-side data client.
 *
 * DASHBOARD READS NOW COME FROM THE SERVER.
 *
 * `.from(…)` and `.rpc(…)` are executed by a server action that derives the
 * caller from the HTTP-only session cookie and replays the query against
 * SQLite (see `./browser-query` and `@/lib/server/sql-dashboard`). The pages
 * above this seam keep the exact same chain and the exact same
 * `{ data, error, count }` results, so no dashboard query code changes — but
 * no payload the browser supplies can decide WHO is being read, because the
 * server ANDs in the session's own user regardless.
 *
 * Nothing is stored in the browser: no localStorage, no IndexedDB. The only
 * client-side state is the HTTP-only session cookie the server sets.
 */
import { dashboardRpc, DashboardTableQuery } from "@/lib/supabase/browser-query";
import type { DashboardQueryResult } from "@/lib/dashboard-query";

/** The public browser client shape. */
export interface BrowserDataClient {
  from(table: string): DashboardTableQuery;
  rpc(name: string, args?: Record<string, unknown>): Promise<DashboardQueryResult>;
}

export function createSupabaseBrowserClient(): BrowserDataClient {
  return {
    from: (table: string) => new DashboardTableQuery(table),
    rpc: (name: string, args: Record<string, unknown> = {}) => dashboardRpc(name, args),
  };
}
