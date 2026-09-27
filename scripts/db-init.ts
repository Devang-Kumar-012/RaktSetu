/**
 * PRODUCTION DATABASE INITIALIZATION.
 *
 * Run before the server starts serving:
 *
 *   npm run db:init
 *
 * It is IDEMPOTENT and NON-DESTRUCTIVE — see `initializeDatabase` in
 * src/lib/server/db.ts. On a fresh persistent volume it creates the directory,
 * the database file, the full schema and the demo administrator. On an existing
 * volume it re-opens the same file and re-applies the (idempotent) migrations.
 * It never drops a table and never deletes an account, so it is safe to run on
 * every deploy.
 *
 * It prints WHERE it is operating, because that is the one thing an operator must
 * confirm on a new host — a database silently created inside the container
 * layer instead of on the mounted volume is precisely the failure this
 * deployment work exists to prevent.
 */
import { DB_FILE, initializeDatabase } from "../src/lib/server/db";

try {
  initializeDatabase();
  console.log(`database ready: ${DB_FILE}`);
} catch (err) {
  const e = err as { reason?: string; detail?: string };
  console.error(
    `database NOT ready: ${e?.reason ?? "unknown"} — ${e?.detail ?? String(err)}`,
  );
  console.error(
    "Set RAKTSETU_DATA_DIR to a PERSISTENT WRITABLE volume the server can keep across restarts.",
  );
  process.exit(1);
}
