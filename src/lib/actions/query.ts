"use server";

/**
 * The server-action seam for dashboard payload reads.
 *
 * The donor and requester dashboards are Client Components, so their queries
 * are built in the browser and executed HERE: one action per read kind, each
 * deriving the caller from the HTTP-only session cookie. Nothing in the
 * payload decides who the caller is — a spec may name any table, filter or
 * request id it likes, and the executor still ANDs in the session's own user
 * before a row can come back.
 *
 * Both exports are async functions and nothing else, as a `"use server"`
 * module is required to be.
 */

import { getSessionInfo } from "@/lib/profile";
import type { DashboardQueryResult, TableQuerySpec } from "@/lib/dashboard-query";
import { runDashboardRpc, runDashboardTableQuery } from "@/lib/server/sql-dashboard";

const signedOut = (): DashboardQueryResult => ({
  data: null,
  error: { message: "Please sign in to view this page." },
});

/** Execute one chained `.from(…).select(…).eq(…)` read against SQLite. */
export async function readDashboardTable(
  spec: TableQuerySpec,
): Promise<DashboardQueryResult> {
  const { user } = await getSessionInfo();
  if (!user) return signedOut();
  try {
    return await runDashboardTableQuery(spec, { id: user.id, role: user.role });
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : "Could not read that data." },
    };
  }
}

/** Execute one `.rpc(name, args)` projection against SQLite. */
export async function readDashboardRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<DashboardQueryResult> {
  const { user } = await getSessionInfo();
  if (!user) return signedOut();
  try {
    return await runDashboardRpc(name, args, { id: user.id, role: user.role });
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : "Could not read that data." },
    };
  }
}
