/**
 * THE DATA DRIVER — one persistence seam, two backends.
 *
 * WHY THIS EXISTS
 *
 * RaktSetu's data is a SQLite database, and SQLite has two very different ways
 * to be reached:
 *
 *   - a LOCAL FILE, via Node's built-in `node:sqlite`. Synchronous, zero
 *     dependencies, correct for `npm run dev` and the whole test suite.
 *   - a REMOTE libSQL/Turso database, over HTTPS. This is what a genuinely $0
 *     host can offer, because a free host has no persistent disk — but the DATA
 *     still has to be durable somewhere, and Turso's free tier is real: 5 GB,
 *     500M rows read/mo, 10M rows written/mo, no credit card, no expiry.
 *
 * Both speak the SAME SQL dialect, and that is the entire reason this migration
 * is tractable: the 18 tables, the CHECK constraints, the triggers, the foreign
 * keys and the request-lifecycle guards carry across UNCHANGED. Only the
 * transport differs. A Postgres target would have forced a rewrite of every
 * trigger into PL/pgSQL; this does not.
 *
 * THE ASYNESS CONSEQUENCE, STATED PLAINLY
 *
 * The local driver is synchronous; a remote one cannot be. So this seam is
 * ASYNC and every caller must `await`. That is a deliberate, visible cost — the
 * price of durable storage on a host with no disk — paid once at this single
 * interface instead of being scattered through the application.
 *
 * WHAT MUST NOT CHANGE
 *
 * The race-safety rules. `transaction()` is IMMEDIATE on both backends, because
 * "first valid donor wins" depends on taking the write lock up front rather than
 * upgrading mid-transaction. An optimistic best-effort transaction would let two
 * concurrent acceptances each believe they won.
 */
import { mkdirSync, closeSync, openSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** Values a driver will bind. Both backends accept this set. */
export type SqlParam = string | number | bigint | Buffer | null;

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/** A transaction handle: the same surface as a Driver, bound to one transaction. */
export interface Tx {
  query<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(
    sql: string,
    params?: SqlParam[],
  ): Promise<T | undefined>;
  run(sql: string, params?: SqlParam[]): Promise<RunResult>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (t: Tx) => Promise<T>): Promise<T>;
}

export interface Driver extends Tx {
  /** Which backend answered — for diagnostics and the health endpoint. */
  readonly kind: "sqlite" | "libsql";
  close(): Promise<void>;
}

/**
 * THE CONFIGURATION THAT SELECTS THE BACKEND.
 *
 * `RAKTSETU_DATABASE_URL` (+ `RAKTSETU_DATABASE_TOKEN`) points at a remote
 * libSQL/Turso database. Unset, the local file backend is used — which is what
 * development and every test in this repository do.
 *
 * `RAKTSETU_DATA_DIR` still names the LOCAL file's directory, and is ignored
 * when a remote URL is set, because in that mode there is no local file.
 *
 * Both are server-only values and are never exposed to the browser.
 */
function remoteUrl(): string | null {
  return process.env.RAKTSETU_DATABASE_URL?.trim() || null;
}

/** Thrown when storage cannot be reached, with a reason callers can classify. */
export class StorageUnavailableError extends Error {
  readonly reason: "remote-unconfigured" | "remote-unreachable" | "local-unwritable";
  readonly detail: string;
  constructor(reason: StorageUnavailableError["reason"], detail: string) {
    super(`storage unavailable (${reason})`);
    this.name = "StorageUnavailableError";
    this.reason = reason;
    this.detail = detail;
  }
}

const DATA_DIR = process.env.RAKTSETU_DATA_DIR?.trim() || join(process.cwd(), "data");
export const LOCAL_DB_FILE = join(DATA_DIR, "raktsetu.db");

/**
 * Prove the directory is writable before trusting it.
 *
 * A real create/write/unlink is used rather than `access(W_OK)`, because
 * permission bits routinely disagree with what the kernel will actually allow.
 */
export function assertLocalStorageUsable(dir: string): void {
  let probe: string;
  try {
    mkdirSync(dir, { recursive: true });
    probe = join(dir, `.raktsetu-probe-${process.pid}`);
    const fd = openSync(probe, "wx");
    closeSync(fd);
    unlinkSync(probe);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const readOnly = e.code === "EROFS" || e.code === "EPERM";
    throw new StorageUnavailableError(
      "local-unwritable",
      `${e.code ?? "unknown"}: ${e.message ?? String(err)}`,
    );
  }
}

/**
 * `node:sqlite` is resolved lazily, on first use.
 *
 * A static import would put the builtin into Next's BUILD-TIME module graph,
 * which has previously stopped the build dead. Resolving on demand keeps it out
 * of that graph — and keeps the application working when it is never reached at
 * all, because the remote backend needs no builtin.
 */
interface SqliteConn {
  prepare(sql: string): {
    run(...p: SqlParam[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...p: SqlParam[]): unknown;
    all(...p: SqlParam[]): unknown[];
  };
  exec(sql: string): void;
  close(): void;
}

type SqliteCtor = new (path: string) => SqliteConn;

let sqliteCtor: SqliteCtor | null = null;
function loadSqlite(): SqliteCtor {
  if (!sqliteCtor) {
    const { createRequire } = require("node:module") as typeof import("node:module");
    sqliteCtor = createRequire(import.meta.url)("node:sqlite").DatabaseSync as SqliteCtor;
  }
  return sqliteCtor;
}

let localDriver: Driver | null = null;

function makeLocalDriver(conn: SqliteConn, inTx = false): Driver {
  const d: Driver = {
    kind: "sqlite",
    async query<T>(sql: string, params: SqlParam[] = []) {
      return conn.prepare(sql).all(...params) as T[];
    },
    async queryOne<T>(sql: string, params: SqlParam[] = []) {
      return conn.prepare(sql).get(...params) as T | undefined;
    },
    async run(sql: string, params: SqlParam[] = []) {
      const info = conn.prepare(sql).run(...params);
      return { changes: Number(info.changes), lastInsertRowid: info.lastInsertRowid };
    },
    async exec(sql: string) {
      conn.exec(sql);
    },
    /**
     * IMMEDIATE takes the write lock up front, so two concurrent acceptances
     * serialise at BEGIN rather than failing late with SQLITE_BUSY. That is what
     * makes "re-read the winner, then write mine" safe.
     */
    async transaction<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
      if (inTx) return fn(d); // already inside one: join it, never nest
      conn.exec("BEGIN IMMEDIATE");
      try {
        const out = await fn(d);
        conn.exec("COMMIT");
        return out;
      } catch (err) {
        try {
          conn.exec("ROLLBACK");
        } catch {
          /* already unwound */
        }
        throw err;
      }
    },
    async close() {
      conn.close();
    },
  };
  return d;
}

/** The local file driver, opened and configured on first use. */
export function getLocalDriver(): Driver {
  if (localDriver) return localDriver;
  assertLocalStorageUsable(DATA_DIR);
  const conn: SqliteConn = new (loadSqlite())(LOCAL_DB_FILE);
  // WAL needs a writable directory beside the file; a platform that allows the
  // file but not its -wal/-shm siblings is not durable, so it is refused rather
  // than silently degrading to a journal mode that loses writes.
  conn.exec("PRAGMA journal_mode = WAL;");
  conn.exec("PRAGMA foreign_keys = ON;");
  conn.exec("PRAGMA busy_timeout = 5000;");
  localDriver = makeLocalDriver(conn);
  return localDriver;
}

// ---------------------------------------------------------------------------
// REMOTE BACKEND — libSQL / Turso over HTTPS.
//
// The official client is imported LAZILY and only when a remote URL is set, so
// the dependency never enters the build graph, and a local build neither needs
// nor loads it.
// ---------------------------------------------------------------------------

type LibsqlResult = {
  rows: Array<Record<string, unknown>>;
  rowsAffected: number;
  lastInsertRowid?: number | bigint;
};
type LibsqlStmt = { sql: string; args?: SqlParam[] };
type LibsqlClient = {
  execute(stmt: LibsqlStmt | string, args?: SqlParam[]): Promise<LibsqlResult>;
  /**
   * Runs a SCRIPT of several statements.
   *
   * This is required, not optional. `execute()` prepares ONE statement and runs
   * it, so a multi-statement DDL block is silently truncated to its first
   * statement. The schema is created from exactly such blocks, so using
   * `execute()` here would build a database with one or two tables and no error
   * at all — a failure that only surfaces in production as "no such table".
   */
  executeMultiple(sql: string): Promise<void>;
  batch(stmts: LibsqlStmt[], mode?: string): Promise<LibsqlResult[]>;
  transaction(mode?: string): Promise<LibsqlTransaction>;
  close(): void;
};
type LibsqlTransaction = {
  execute(stmt: LibsqlStmt | string, args?: SqlParam[]): Promise<LibsqlResult>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): void;
};

function makeRemoteDriver(client: LibsqlClient, inTx = false): Driver {
  const d: Driver = {
    kind: "libsql",
    async query<T>(sql: string, params: SqlParam[] = []) {
      const res = await client.execute({ sql, args: params });
      return res.rows as T[];
    },
    async queryOne<T>(sql: string, params: SqlParam[] = []) {
      const res = await client.execute({ sql, args: params });
      return (res.rows[0] as T | undefined);
    },
    async run(sql: string, params: SqlParam[] = []) {
      const res = await client.execute({ sql, args: params });
      return {
        changes: Number(res.rowsAffected ?? 0),
        lastInsertRowid: res.lastInsertRowid ?? 0,
      };
    },
    async exec(sql: string) {
      // `executeMultiple`, never `execute`: see the type's doc comment. The local
      // backend's `exec()` runs many statements; this is its remote equivalent.
      await client.executeMultiple(sql);
    },
    /**
     * A WRITE transaction, which on libSQL is an exclusive server-side
     * transaction. That is the same guarantee `BEGIN IMMEDIATE` gives on a local
     * file, and it is what keeps "first valid donor wins" correct when two
     * acceptances race.
     */
    async transaction<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
      if (inTx) return fn(d); // join the existing transaction; never nest
      const tx = await client.transaction("write");
      const scoped = makeRemoteDriver(tx as unknown as LibsqlClient, true);
      try {
        const out = await fn(scoped);
        await tx.commit();
        return out;
      } catch (err) {
        try {
          await tx.rollback();
        } catch {
          /* already unwound server-side */
        }
        throw err;
      } finally {
        try {
          tx.close();
        } catch {
          /* nothing left to close */
        }
      }
    },
    async close() {
      client.close();
    },
  };
  return d;
}

let remoteDriver: Driver | null = null;

async function getRemoteDriver(url: string): Promise<Driver> {
  if (remoteDriver) return remoteDriver;
  let client: LibsqlClient;
  try {
    // Dynamic so this dependency is only ever loaded in remote mode.
    const mod = (await import("@libsql/client")) as unknown as {
      createClient: (cfg: { url: string; authToken?: string }) => LibsqlClient;
    };
    const token = process.env.RAKTSETU_DATABASE_TOKEN?.trim();
    client = mod.createClient(token ? { url, authToken: token } : { url });
  } catch (err) {
    throw new StorageUnavailableError(
      "remote-unconfigured",
      `@libsql/client could not be loaded: ${(err as Error).message}`,
    );
  }
  remoteDriver = makeRemoteDriver(client);
  return remoteDriver;
}

// ---------------------------------------------------------------------------
// THE SELECTOR — the single place the backend is chosen.
// ---------------------------------------------------------------------------

let active: Promise<Driver> | null = null;

/**
 * The authoritative driver for this process.
 *
 * Memoised as a PROMISE, not a value, because the remote backend resolves
 * asynchronously. Two concurrent first callers therefore share ONE client
 * rather than racing to create two, which matters for a hosted database where a
 * stray second client would mean a stray second connection pool.
 */
export function getDriver(): Promise<Driver> {
  const url = remoteUrl();
  if (!url) {
    // The local file backend is synchronous to construct, but it is returned
    // through a promise so every caller has exactly one shape to await.
    active ??= Promise.resolve(getLocalDriver()).then(bootstrapSchema);
  } else if (!active) {
    active = getRemoteDriver(url).then(bootstrapSchema).catch((err) => {
      // A failed attempt must not be cached forever, or one transient outage at
      // boot would brick the process with no way to recover.
      active = null;
      throw err;
    });
  }
  return active;
}

/**
 * Create the schema before the first query reaches the caller.
 *
 * A hosted database arrives EMPTY, and an empty database turns the first write
 * into `SQLITE_ERROR: no such table: users` — a RUNTIME error, so the build stays
 * green and the deployment looks healthy while registration is broken. Doing it
 * here makes "connected" mean "connected to a usable schema", which is the only
 * way that stays true on a host with no start-up hook of its own.
 *
 * `./db` is imported DYNAMICALLY on purpose: `db.ts` statically imports this
 * module for the driver type and the connection accessor, so a static
 * back-import would be a cycle. The already-open driver is passed in, so
 * `ensureSchema` never re-enters `getDriver()`.
 */
async function bootstrapSchema(d: Driver): Promise<Driver> {
  const { ensureSchema } = await import("./db");
  await ensureSchema(d);
  return d;
}

/** Which backend is configured, without opening anything. */
export function driverKind(): "sqlite" | "libsql" {
  return remoteUrl() ? "libsql" : "sqlite";
}

/** Close the active driver. For tests and graceful shutdown. */
export async function closeDriver(): Promise<void> {
  const d = active ? await active.catch(() => null) : null;
  if (d) await d.close();
  active = null;
  remoteDriver = null;
  localDriver = null;
  // The migration memo must go with the connection. A check that deletes the
  // database file and then reopens it would otherwise be told "already
  // migrated" and handed a connection to an empty file.
  try {
    const { resetSchemaMemo } = await import("./db");
    resetSchemaMemo();
  } catch {
    // db.ts may not be loaded yet (nothing has connected). Nothing to reset.
  }
}

