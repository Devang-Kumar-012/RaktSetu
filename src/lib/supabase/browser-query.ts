/**
 * The browser half of the dashboard read seam.
 *
 * It reproduces the slice of the Supabase query-builder API the dashboards
 * actually use, but instead of talking to a store it COLLECTS the chain into a
 * `TableQuerySpec` and hands it to a server action on `await`. The server
 * derives the caller from the session cookie and replays the chain against
 * SQLite, so a read can never be scoped by anything this file supplies.
 *
 * Reads only. A mutating call is a programming error here — writes go through
 * server actions, which re-check the session themselves — so it throws loudly
 * rather than resolving to a no-op that would look like a successful write.
 */

import { readDashboardRpc, readDashboardTable } from "@/lib/actions/query";
import type {
  DashboardQueryResult,
  FilterOp,
  TableFilter,
  TableOrder,
  TableQuerySpec,
} from "@/lib/dashboard-query";

export class DashboardTableQuery implements PromiseLike<DashboardQueryResult> {
  private readonly filters: TableFilter[] = [];
  private readonly orGroups: string[] = [];
  private readonly orders: TableOrder[] = [];
  private limitTo: number | null = null;
  private offsetTo = 0;
  private columns: string | null = null;
  private wantCount = false;
  private headOnly = false;

  constructor(private readonly table: string) { }

  select(columns?: string, options?: { count?: string; head?: boolean }): this {
    this.columns = columns ?? null;
    this.wantCount = options?.count === "exact";
    this.headOnly = options?.head === true;
    return this;
  }

  private add(op: FilterOp, column: string, value: unknown): this {
    this.filters.push({ column, op, value });
    return this;
  }

  eq(column: string, value: unknown): this { return this.add("eq", column, value); }
  /** PostgREST `is` — null / true / false checks. */
  is(column: string, value: unknown): this { return this.add("eq", column, value); }
  neq(column: string, value: unknown): this { return this.add("neq", column, value); }
  in(column: string, values: unknown[]): this { return this.add("in", column, values); }
  gt(column: string, value: unknown): this { return this.add("gt", column, value); }
  gte(column: string, value: unknown): this { return this.add("gte", column, value); }
  lt(column: string, value: unknown): this { return this.add("lt", column, value); }
  lte(column: string, value: unknown): this { return this.add("lte", column, value); }
  like(column: string, value: unknown): this { return this.add("like", column, value); }

  /** Raw PostgREST `or(...)` filter string; replayed verbatim by the server. */
  or(filters: string): this {
    this.orGroups.push(filters);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(n: number): this {
    this.limitTo = n;
    return this;
  }

  range(from: number, to: number): this {
    this.offsetTo = from;
    this.limitTo = to - from + 1;
    return this;
  }

  private spec(): TableQuerySpec {
    return {
      table: this.table,
      columns: this.columns,
      count: this.wantCount,
      head: this.headOnly,
      filters: this.filters,
      orGroups: this.orGroups,
      orders: this.orders,
      limit: this.limitTo,
      offset: this.offsetTo,
    };
  }

  /**
   * Runs the read. A transport or unexpected failure resolves to an ERROR
   * result rather than throwing, so one bad query cannot white-screen the
   * page — the page shows its own empty/error state instead.
   */
  private async run(): Promise<DashboardQueryResult> {
    try {
      return await readDashboardTable(this.spec());
    } catch (err) {
      return {
        data: null,
        error: { message: err instanceof Error ? err.message : "Could not read that data." },
      };
    }
  }

  then<TResult1 = DashboardQueryResult, TResult2 = never>(
    onfulfilled?: ((value: DashboardQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  async single(): Promise<DashboardQueryResult> {
    const result = await this.run();
    if (result.error) return result;
    const rows = (result.data ?? []) as unknown[];
    if (rows.length === 0) {
      return { data: null, error: { message: "No rows found", code: "PGRST116" } };
    }
    return { ...result, data: rows[0] };
  }

  async maybeSingle(): Promise<DashboardQueryResult> {
    const result = await this.run();
    if (result.error) return result;
    const rows = (result.data ?? []) as unknown[];
    return { ...result, data: rows[0] ?? null };
  }

  /** Writes are not this seam's job; refuse them where the call is made. */
  private refuseWrites(): never {
    throw new Error(
      `Dashboard reads are server-backed; mutate "${this.table}" through a server action instead.`,
    );
  }
  insert(): this { return this.refuseWrites(); }
  upsert(): this { return this.refuseWrites(); }
  update(): this { return this.refuseWrites(); }
  delete(): this { return this.refuseWrites(); }
}

/** `supabase.rpc(name, args)` for the dashboard surface. */
export async function dashboardRpc(
  name: string,
  args: Record<string, unknown> = {},
): Promise<DashboardQueryResult> {
  try {
    return await readDashboardRpc(name, args);
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : "Could not read that data." },
    };
  }
}
