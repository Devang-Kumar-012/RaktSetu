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
 * `auth` and `channel` still resolve to the local adapter, exactly as before:
 * the session lives in a cookie both sides already share, and realtime is a
 * no-op that merely triggers refreshes. Nothing here needs an API key, a
 * backend URL or any configuration — a deployment with no configuration still
 * works.
 */
import { createLocalClient, type LocalClient, type LocalChannel } from "@/lib/local/adapter";
import { dashboardRpc, DashboardTableQuery } from "@/lib/supabase/browser-query";
import type { DashboardQueryResult } from "@/lib/dashboard-query";

/** The public browser client shape. */
export interface BrowserDataClient {
  from(table: string): DashboardTableQuery;
  rpc(name: string, args?: Record<string, unknown>): Promise<DashboardQueryResult>;
  /** Session and credential handling — still the local adapter's own. */
  auth: LocalClient["auth"];
  /** Realtime shim; a no-op that keeps the refresh call chain valid. */
  channel(name: string): LocalChannel;
  removeChannel(channel: LocalChannel): Promise<void>;
}

export function createSupabaseBrowserClient(): BrowserDataClient {
  const legacy = createLocalClient();
  return {
    from: (table: string) => new DashboardTableQuery(table),
    rpc: (name: string, args: Record<string, unknown> = {}) => dashboardRpc(name, args),
    auth: legacy.auth,
    channel: (name: string) => legacy.channel(name),
    removeChannel: (channel: LocalChannel) => legacy.removeChannel(channel),
  };
}

