/**
 * The browser → server contract for dashboard payload reads.
 *
 * The donor and requester dashboards are Client Components: they build a
 * query with the familiar Supabase-shaped chain
 * (`.from(t).select().eq().order().limit()` / `.rpc(name, args)`) and await it.
 * The chain is now collected into a plain `TableQuerySpec` and executed by a
 * server action against SQLite, so the browser never touches a data store
 * itself and never names who it is — the server reads the identity from the
 * HTTP-only session cookie.
 *
 * This module is deliberately DEPENDENCY-FREE: it is imported by the client
 * builder and by the server executor, so it must pull in neither the browser
 * layer nor `node:*`.
 */

/** Filter operators both sides understand (PostgREST spellings). */
export type FilterOp =
  | "eq"
  | "neq"
  | "in"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like";

export interface TableFilter {
  column: string;
  op: FilterOp;
  value: unknown;
}

export interface TableOrder {
  column: string;
  ascending: boolean;
}

/**
 * Everything needed to replay one chained read on the server.
 *
 * Values are carried as-is and bound as SQL parameters on arrival; column and
 * table names are checked against an allow-list there, so a crafted spec
 * cannot inject SQL. `offset > 0` only ever arrives together with `limit`
 * (`.range(from, to)` records both), which is what a paginated read needs.
 */
export interface TableQuerySpec {
  table: string;
  /** Select list. The SQLite adapter currently returns whole rows; kept for parity. */
  columns: string | null;
  count: boolean;
  head: boolean;
  filters: TableFilter[];
  /** Raw PostgREST `.or(...)` strings, OR-ed as one group and AND-ed in. */
  orGroups: string[];
  orders: TableOrder[];
  limit: number | null;
  offset: number;
}

/**
 * Result shape of every dashboard read — the same `{ data, error, count? }`
 * the pages already destructure, so no call site above this seam changes.
 */
export interface DashboardQueryResult<T = any> {
  data: T | null;
  error: { message: string; code?: string } | null;
  /** Row count for `.select(cols, { count: "exact" })`, sibling of `data`. */
  count?: number | null;
}
