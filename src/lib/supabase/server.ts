/**
 * Server-side data client for Server Components, Server Actions and handlers.
 *
 * Kept async and under the same name so every existing call site — server
 * actions, pages, route handlers — works untouched. See the block below for
 * what it returns now and why.
 */
import { createLocalClient } from "@/lib/local/adapter";
import { createSqlClient } from "@/lib/server/sql-adapter";

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
 * `rpc` AND `auth` ARE STILL DELEGATED — DELIBERATELY
 *
 * The SQLite client implements table access (`from`) only: its `rpc` is a stub
 * that always errors, and it has no `auth` member. Swapping the whole object
 * would therefore regress every `.rpc(...)` page and make
 * `endSessionAndReportSuspension()` throw — that is the call which calls
 * `auth.signOut()` to revoke a suspended account's session. Those two members
 * keep their existing implementations so behaviour is preserved exactly while
 * table access moves to SQLite. Porting them is a separate, later step.
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
    /** Preserved from the legacy adapter; the SQLite client has no rpc yet. */
    rpc: legacy.rpc,
    /** Preserved so suspension still revokes the session cookie. */
    auth: legacy.auth,
  };
}

