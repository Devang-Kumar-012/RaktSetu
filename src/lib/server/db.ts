/**
 * Server-side SQLite — the single source of truth.
 *
 * Uses Node's BUILT-IN `node:sqlite` (Node >= 22.13, the first release that
 * loads it without the `--experimental-sqlite` flag this module never passes),
 * so RaktSetu needs no database driver, no connection string and no external
 * service. The database is a single file on the server's disk; the browser
 * never sees it.
 *
 * The schema mirrors the entity model the application already uses, so the
 * data-access layer maps one-to-one and existing pages/actions keep working
 * against the server instead of the browser.
 *
 * Everything is created on first access: no manual SQL, no migration command to
 * remember, and a restart re-opens the same file.
 */

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { closeSync, mkdirSync, openSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { driverKind, getDriver, type Driver } from "./driver";

import {
  DEMO_ADMIN_EMAIL,
  DEMO_ADMIN_NAME,
  DEMO_ADMIN_PASSWORD,
} from "@/lib/demo-account";
import { hashPassword } from "./password";

/**
 * WHY THE DATABASE PATH IS CHOSEN THIS WAY
 *
 * The database is one file, so it needs a directory that is BOTH writable AND
 * durable. Those are different requirements and confusing them is how a server
 * ends up quietly losing data:
 *
 *  - A read-only working directory (a deployed serverless bundle) means the
 *    file cannot be created at all. That must fail loudly, and say so.
 *  - A WRITABLE BUT EPHEMERAL directory (a container's /tmp) is worse. Writes
 *    would succeed, the user would be told they registered, and the account
 *    would silently disappear on the next cold start. So this module NEVER
 *    falls back to a temporary directory: a fake success that loses people's
 *    accounts is far worse than an honest failure.
 *
 * `RAKTSETU_DATA_DIR` (see DATA_DIR below) therefore points at a MOUNTED
 * PERSISTENT VOLUME in production, and defaults to `./data` beside the app for
 * local development. `getDb()` proves the directory can actually be written to
 * before trusting it, and raises a classified `DatabaseUnavailableError` when
 * it cannot. Never sent to the browser.
 */

/**
 * WHY THIS EXISTS
 *
 * A failure to open the database used to surface as an anonymous
 * `EACCES: permission denied, mkdir '.../data'` from three frames deep. It was
 * caught by the registration action and reported to the user as a generic
 * apology, which told nobody anything.
 *
 * This error carries a `reason` the rest of the app can classify without
 * pattern-matching English or driver strings, so the message a user sees is
 * derived from what actually went wrong. The raw path and code stay in the
 * server log, never in the response.
 */
export type DatabaseUnavailableReason =
  /** The directory exists but cannot be written to (read-only deployment). */
  | "storage-read-only"
  /** The directory could not be created or written to for another reason. */
  | "storage-unwritable"
  /** `node:sqlite` is not available on this runtime. */
  | "sqlite-unavailable"
  /** The driver was present but refused to open the file. */
  | "open-failed"
  /**
   * A remote database is configured, so there is no local file to hand out.
   * Guards against a stray call quietly writing to a throwaway local database
   * that nobody will ever read — the exact "looks deployed, loses everything"
   * failure this architecture exists to prevent.
   */
  | "remote-only";

/**
 * THE ONE OPTIONAL ENVIRONMENT VARIABLE.
 *
 * `RAKTSETU_DATA_DIR` names the directory holding `raktsetu.db`. In production it
 * points at a MOUNTED PERSISTENT VOLUME (e.g. `/data`); unset, it falls back to
 * `./data` beside the app, which is correct for a laptop or a VM checkout.
 *
 * It is read here and NOWHERE else. That restriction is deliberate and enforced
 * by `scripts/check-invariants.ts`: an application whose only configuration is
 * "where my data lives" cannot accumulate secrets, feature flags or client-exposed
 * variables by accident. In particular the session cookie still derives `Secure`
 * from the request's own protocol rather than from here.
 *
 * It is a server-side value. Nothing under this path is ever sent to the browser.
 */
const DATA_DIR =
  process.env.RAKTSETU_DATA_DIR?.trim() || join(process.cwd(), "data");

/** The absolute path of the SQLite file. Authoritative for the whole app. */
const DB_PATH = join(DATA_DIR, "raktsetu.db");

export class DatabaseUnavailableError extends Error {
  readonly reason: DatabaseUnavailableReason;
  /** Raw driver/FS detail. Logged server-side; never returned to a browser. */
  readonly detail: string;

  constructor(reason: DatabaseUnavailableReason, detail: string) {
    super(`database unavailable (${reason})`);
    this.name = "DatabaseUnavailableError";
    this.reason = reason;
    this.detail = detail;
  }
}

/**
 * Prove the storage is usable BEFORE opening, so the failure names the real
 * problem (the filesystem) rather than surfacing as an unrelated SQL error
 * several steps later.
 *
 * A real create/write/unlink is used rather than `access(W_OK)`: permission
 * bits routinely disagree with what the kernel will actually allow, and only
 * doing the real thing is a truthful test.
 */
function assertStorageUsable(dir: string): void {
  let probe: string;
  try {
    mkdirSync(dir, { recursive: true });
    probe = join(dir, `.raktsetu-write-probe-${process.pid}`);
    // Exclusive create: fails if the directory is not writable.
    const fd = openSync(probe, "wx");
    closeSync(fd);
    unlinkSync(probe);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const readOnly = e.code === "EROFS" || e.code === "EPERM";
    throw new DatabaseUnavailableError(
      readOnly ? "storage-read-only" : "storage-unwritable",
      `${e.code ?? "unknown"}: ${e.message ?? String(err)}`,
    );
  }
}

/**
 * `node:sqlite` is resolved lazily, on first use.
 *
 * WHY THIS IS NOT A STATIC IMPORT
 *
 * A static `import ... from "node:sqlite"` puts the builtin into Next's
 * build-time module graph. As soon as the server data seam actually reached
 * this module, `next build` stopped dead at "Collecting page data" and never
 * progressed (0% CPU, no database file ever created, so nothing here had even
 * run). Verified by A/B against the previous working tree. Resolving it on
 * demand keeps it out of that graph, and keeps `getDb()` synchronous — which
 * every caller depends on.
 */
const require_ = createRequire(import.meta.url);
let DatabaseSyncCtor: typeof DatabaseSync | null = null;
function sqliteDatabase(): typeof DatabaseSync {
  if (!DatabaseSyncCtor) {
    try {
      DatabaseSyncCtor = require_("node:sqlite").DatabaseSync as typeof DatabaseSync;
    } catch (err) {
      // Node older than 22.13 cannot load `node:sqlite` unflagged. Name that
      // precisely, because it is a deployment-runtime fault and not a bad query.
      throw new DatabaseUnavailableError(
        "sqlite-unavailable",
        `node:sqlite unavailable: ${(err as Error).message}`,
      );
    }
  }
  return DatabaseSyncCtor;
}

let db: DatabaseSync | null = null;

/**
 * The open connection, created and migrated on first use.
 *
 * Every way this can fail is converted into a `DatabaseUnavailableError` with a
 * `reason`, so the caller can tell the user WHICH part of the platform is
 * missing. Previously the raw `mkdir`/`open` error escaped and was reported as a
 * generic apology.
 */
/**
 * The LOCAL FILE handle, for local development and the offline checks only.
 *
 * This is deliberately not the application's persistence layer any more — that is
 * `getDriver()` in `./driver`, which speaks to either this file or a remote
 * libSQL/Turso database. Nothing in `src/` calls this; the scripts in `scripts/`
 * do, while they are being moved onto the driver.
 *
 * Schema creation is NOT done here. `initializeDatabase()` is the single place
 * migrations run, through the driver, so there is exactly one code path that can
 * create tables — and it is the one that works against a hosted database.
 */
export function getDb(): DatabaseSync {
  if (driverKind() === "libsql") {
    throw new DatabaseUnavailableError(
      "remote-only",
      "a remote database is configured; use getDriver() from ./driver instead of the local file handle",
    );
  }
  if (db) return db;
  assertStorageUsable(dirname(DB_PATH));
  try {
    db = new (sqliteDatabase())(DB_PATH);
  } catch (err) {
    throw new DatabaseUnavailableError(
      "open-failed",
      `open failed: ${(err as Error).message}`,
    );
  }
  // WAL lets readers proceed during a write and survives restarts with the
  // file. NORMAL is the right durability trade for SQLite at this scale.
  //
  // WAL needs a writable directory next to the database; a platform that allows
  // the file but not the -wal/-shm siblings is not durable, so it is refused
  // here rather than silently degrading to a mode that loses writes.
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");
  } catch (err) {
    const detail = (err as Error).message;
    db.close();
    db = null;
    throw new DatabaseUnavailableError("storage-unwritable", `pragmas failed: ${detail}`);
  }
  return db;
}

/** For tests and scripts that need a clean handle. */
export function closeDb(): void {
  db?.close();
  db = null;
}

/**
 * PROVE THE DATABASE IS USABLE, WITHOUT DESTROYING ANYTHING.
 *
 * This is the production startup step, and it is deliberately the safest thing
 * this module can do. Run against a FRESH volume it creates the directory, opens
 * a brand-new file and applies the whole schema and migration set. Run against
 * an EXISTING volume it opens that same file and re-applies the migrations, all
 * of which are idempotent (`CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE`,
 * guarded column rebuilds), so:
 *
 *   - no account, request, donation or notification is ever dropped,
 *   - no table is ever recreated because it "looked wrong",
 *   - the demo administrator is re-seeded only if genuinely absent, and a
 *     password changed through the app is never reset.
 *
 * It is safe to run on every boot. `getDb()` is lazy and already does exactly
 * this work on first use; calling it at startup simply moves the work earlier,
 * turning a first-request stall into a boot-time failure that is visible in the
 * logs instead of a user staring at a stalled page.
 */
export async function initializeDatabase(): Promise<{ ok: true }> {
  // The driver, not `getDb()`: when `RAKTSETU_DATABASE_URL` is set the schema
  // must be created in the REMOTE database. Initialising only a local file here
  // would leave a hosted deployment with no tables at all.
  const db = await getDriver();
  await migrate(db);
  return { ok: true };
}

let schemaPromise: Promise<void> | null = null;

/**
 * MAKE SURE THE SCHEMA EXISTS, ONCE PER PROCESS, BEFORE ANY QUERY RUNS.
 *
 * WHY THIS EXISTS — this is a production bug that shipped.
 *
 * On the hosted deployment the database was NEVER migrated, so the first write
 * failed with
 *
 *   SQLITE_ERROR: no such table: users
 *
 * and registration returned a generic "an unexpected server error occurred"
 * (REG-…) to the user. The cause was structural, not a bad query: the only code
 * that ran the migration was `scripts/db-init.ts` behind the `db:init` npm
 * script, and the only thing that invoked it was the Dockerfile
 * (`db-init` before `next start`). When the deployment moved to a serverless
 * host whose `buildCommand` is just `next build`, that step vanished and
 * nothing replaced it. A brand-new hosted database is empty, and an empty
 * database plus a plain `INSERT` is a RUNTIME error, not a build error — so the
 * deployment looked completely healthy while being unable to register anyone.
 *
 * The lesson: schema creation cannot depend on a build or start hook that some
 * future host may not have. It must be a property of CONNECTING, so the driver
 * now performs it, exactly once, before the first query reaches the caller.
 *
 * WHY THE FAST PATH
 *
 * Re-running the full migration on every cold start would add several round
 * trips to the first request of every serverless instance. `migrate()` seeds
 * `platform_settings` at its very END, after all DDL, so that row is a reliable
 * "the migration completed" marker. One primary-key read skips the work; any
 * less-complete database falls through to the full idempotent migration.
 *
 * WHY A MEMOISED PROMISE
 *
 * Concurrent cold starts must share ONE migration instead of racing to run the
 * same DDL. On failure the memo is cleared so a transient error cannot
 * permanently poison the instance.
 *
 * WHY `db` IS A PARAMETER
 *
 * `driver.ts` calls this during connection setup and cannot statically import
 * this module (that would be a cycle). Passing the already-open driver lets the
 * bootstrap finish without re-entering `getDriver()`.
 */
export async function ensureSchema(db?: Driver): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const conn = db ?? (await getDriver());
      // Fast path. This MUST tolerate the table being absent: on a brand-new
      // hosted database the probe itself raises "no such table:
      // platform_settings", and treating that as fatal would merely replace one
      // failure ("no such table: users") with another instead of migrating.
      // "Table missing" is the answer "not migrated yet", not an error.
      let migrated = false;
      try {
        const seeded = await conn.queryOne<{ id: number }>(
          "SELECT id FROM platform_settings WHERE id = 1",
        );
        migrated = !!seeded;
      } catch {
        migrated = false;
      }
      if (migrated) return;
      await migrate(conn);
    })().catch((err) => {
      // Do not cache a failure: the next request should get a real attempt.
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

/** Forget the memoised migration. For tests that reset the database. */
export function resetSchemaMemo(): void {
  schemaPromise = null;
}

/** True when the configured database answers. Used by /api/health. */
export async function isDatabaseOperational(): Promise<boolean> {
  try {
    const db = await getDriver();
    await db.queryOne("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/**
 * `blood_requests`, split out of SCHEMA_HEAD because `migrate()` rebuilds the
 * table when the location column changes shape. SQLite cannot ALTER a column
 * that other things depend on while preserving every row, so the corrected DDL
 * has to be available on its own.
 */
const SCHEMA_REQUESTS = `
CREATE TABLE IF NOT EXISTS blood_requests (
  id                TEXT PRIMARY KEY,
  requester_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_name    TEXT NOT NULL,
  requester_phone   TEXT NOT NULL,
  blood_group       TEXT NOT NULL,
  blood_component   TEXT NOT NULL,
  units             INTEGER NOT NULL CHECK (units > 0),
  -- The general area where the blood is needed. NOT a hospital and NOT an
  -- address: an approximate locality, compared against a donor's own locality.
  locality          TEXT NOT NULL,
  urgency           TEXT NOT NULL,
  required_by       TEXT NOT NULL,
  note              TEXT,
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','fulfilled','cancelled','expired')),
  latitude          REAL,
  longitude         REAL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  -- When the request reached its terminal state. Kept separate from
  -- updated_at so "closed, and closed WHEN" survives later edits.
  cancelled_at      TEXT,
  fulfilled_at      TEXT
);
`;

/**
 * Terminal states are terminal. Enforced by the DATABASE, not by a button:
 * a row may only leave 'active' once, and a closed request can never be
 * reopened or re-closed. This is what makes a racing cancel/fulfil/expiry lose
 * cleanly instead of double-writing a terminal state.
 *
 * Separate from the table DDL because rebuilding a table drops its triggers.
 */
const SCHEMA_REQUESTS_GUARD = `
CREATE TRIGGER IF NOT EXISTS blood_requests_terminal_guard
BEFORE UPDATE OF status ON blood_requests
FOR EACH ROW WHEN OLD.status <> 'active' AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'a closed request cannot change status');
END;
`;

const SCHEMA_HEAD = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('donor','requester','volunteer','admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  -- The profile this DEVICE is currently acting as. Server-side and NOT in a
  -- cookie: the browser holds an opaque token and nothing else, so the active
  -- role cannot be edited client-side. NULL on a session created before this
  -- column existed, which getUserForToken resolves and persists.
  active_role TEXT
);

-- ROLE MEMBERSHIP. The account is the identity; this is what the account may DO.
--
-- One email is one users row, forever. What that account is allowed to be —
-- a donor, a requester, a volunteer, an administrator — is a set of rows here,
-- so a person can give blood AND request blood without a second account, a
-- second email, or a second login.
--
-- The users.role column is the LEGACY single-role field. It is kept only so an older
-- database file still opens, and it is NEVER read for authorization: this table
-- is the one authoritative source, and migrate() seeds it from that column on
-- first boot. A CHECK constraint is deliberately NOT applied to users.role for
-- new rows by any code path — nothing writes it after the backfill.
--
-- is_primary marks the role the account starts in, so a brand-new dual-role
-- user lands somewhere sensible without anyone choosing.
CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('donor','requester','volunteer','admin')),
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role)
);
CREATE INDEX IF NOT EXISTS user_roles_role_idx ON user_roles(role);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS donor_profiles (
  user_id            TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  blood_group        TEXT,
  locality           TEXT,
  phone              TEXT,
  latitude           REAL,
  longitude          REAL,
  availability       TEXT NOT NULL DEFAULT 'temporarily_unavailable',
  last_donation_date TEXT,
  donation_count     INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS volunteer_profiles (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone      TEXT,
  locality   TEXT,
  available  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ring_progress (
  request_id       TEXT PRIMARY KEY REFERENCES blood_requests(id) ON DELETE CASCADE,
  ring_index       INTEGER NOT NULL DEFAULT 1,
  started_at       TEXT NOT NULL,
  last_advanced_at TEXT NOT NULL,
  finished_at      TEXT,
  outcome          TEXT
);

`;

/**
 * `donor_alerts`, kept as its own constant because `migrate()` rebuilds the
 * table in place when the status vocabulary changes — SQLite cannot ALTER a
 * CHECK constraint, so the corrected DDL has to be available on its own.
 */
const SCHEMA_ALERTS = `
CREATE TABLE IF NOT EXISTS donor_alerts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id       TEXT NOT NULL REFERENCES blood_requests(id) ON DELETE CASCADE,
  donor_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ring_index       INTEGER NOT NULL,
  ring_km          REAL NOT NULL,
  status           TEXT NOT NULL DEFAULT 'sent'
                     -- 'responded' is the state once the donor has answered,
                     -- whichever way they answered; the ANSWER itself is the
                     -- separate response column. Keeping the two apart is what
                     -- lets a declined alert stay declined without being
                     -- reopened. This mirrors LocalDonorAlert's vocabulary, so
                     -- the two engines cannot drift.
                     CHECK (status IN ('sent','opened','responded','expired')),
  response         TEXT CHECK (response IS NULL OR response IN ('accepted','declined')),
  due_at           TEXT NOT NULL,
  responded_at     TEXT,
  reminder_sent_at TEXT,
  created_at       TEXT NOT NULL,
  UNIQUE (request_id, donor_id)
);
CREATE INDEX IF NOT EXISTS donor_alerts_donor_idx ON donor_alerts(donor_id, status);
`;

/*
 * FIRST-VALID-DONOR-WINS.
 *
 * A donor may answer ONCE — that is the table's own UNIQUE(request_id,
 * donor_id). This partial index is a SEPARATE guarantee, on `request_id` ALONE.
 * Scoping it to (request_id, donor_id) as well would merely restate the UNIQUE
 * above and would let TWO DIFFERENT donors each hold an acceptance for the same
 * request, because (req1,donorA) and (req1,donorB) are distinct rows. This
 * index is what makes the second acceptance a constraint failure, so the race is
 * decided by the database rather than by any application-level "has someone
 * accepted yet?" check.
 *
 * It is created in `migrate()` rather than in either schema constant, because it
 * has to be dropped and recreated whenever the table above is rebuilt.
 */

const SCHEMA_TAIL = `
CREATE TABLE IF NOT EXISTS donations (
  id              TEXT PRIMARY KEY,
  donor_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id      TEXT REFERENCES blood_requests(id) ON DELETE SET NULL,
  drive_id        TEXT,
  donated_on      TEXT NOT NULL,
  blood_component TEXT NOT NULL,
  units           INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL
);
-- One donation per donor per drive, per request, and per day. These are what
-- stop a repeated submission inflating recognition.
CREATE UNIQUE INDEX IF NOT EXISTS donations_donor_drive_idx
  ON donations(donor_id, drive_id) WHERE drive_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS donations_donor_request_idx
  ON donations(donor_id, request_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS donations_donor_day_idx
  ON donations(donor_id, donated_on);
CREATE INDEX IF NOT EXISTS donations_donor_idx
  ON donations(donor_id, donated_on DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  request_id TEXT REFERENCES blood_requests(id) ON DELETE CASCADE,
  alert_id   INTEGER,
  link       TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL,
  dedupe_key TEXT
);
CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON notifications(user_id, created_at DESC);

-- Event-once: the same logical event never produces two rows. alert_id keys
-- donor events; dedupe_key keys events with neither a request nor an alert.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_event_once_idx
  ON notifications(user_id, kind, COALESCE(request_id,''), COALESCE(alert_id,0), COALESCE(dedupe_key,''));

CREATE TABLE IF NOT EXISTS campus_blood_drives (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  organizer        TEXT NOT NULL,
  drive_date       TEXT NOT NULL,
  starts_at        TEXT NOT NULL,
  ends_at          TEXT,
  venue            TEXT NOT NULL,
  locality         TEXT NOT NULL,
  description      TEXT,
  target_units     INTEGER,
  status           TEXT NOT NULL DEFAULT 'upcoming'
                     CHECK (status IN ('upcoming','ongoing','completed','cancelled')),
  published        INTEGER NOT NULL DEFAULT 0,
  reminder_sent_at TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campus_drive_registrations (
  id         TEXT PRIMARY KEY,
  drive_id   TEXT NOT NULL REFERENCES campus_blood_drives(id) ON DELETE CASCADE,
  donor_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'registered'
               CHECK (status IN ('registered','checked_in','participated','absent')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (drive_id, donor_id)
);

CREATE TABLE IF NOT EXISTS request_reports (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES blood_requests(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','under_review','resolved','dismissed')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (reporter_id, request_id)
);

CREATE TABLE IF NOT EXISTS request_assistance (
  id           TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL REFERENCES blood_requests(id) ON DELETE CASCADE,
  volunteer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'assisting'
                 CHECK (status IN ('assisting','stopped')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (request_id, volunteer_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  metadata   TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events(created_at DESC);

CREATE TABLE IF NOT EXISTS platform_settings (
  id                          INTEGER PRIMARY KEY CHECK (id = 1),
  alert_rings_km              TEXT NOT NULL DEFAULT '3,7,15',
  alert_window_minutes        INTEGER NOT NULL DEFAULT 10,
  alert_due_at_offset_minutes INTEGER NOT NULL DEFAULT 120,
  donation_interval_days      INTEGER NOT NULL DEFAULT 90,
  max_alert_rings             INTEGER NOT NULL DEFAULT 5,
  cooldown_reminder_lead_days INTEGER NOT NULL DEFAULT 3,
  donor_alert_reminder_hours  INTEGER NOT NULL DEFAULT 24,
  drive_reminder_window_hours INTEGER NOT NULL DEFAULT 48,
  updated_at                  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_safety_limits (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  max_requests_per_hour   INTEGER NOT NULL DEFAULT 6,
  max_reports_per_hour    INTEGER NOT NULL DEFAULT 8,
  max_alert_responses     INTEGER NOT NULL DEFAULT 30,
  updated_at              TEXT NOT NULL
);
`;

/**
 * Idempotent migration. Every statement is CREATE ... IF NOT EXISTS, so this
 * runs on every boot and is safe to re-run. There is no separate step.
 */
async function migrate(db: Driver): Promise<void> {
  await db.exec(SCHEMA_HEAD);
  await db.exec(SCHEMA_TAIL);
  const now = new Date().toISOString();

  await db.exec(SCHEMA_REQUESTS);
  await db.exec(SCHEMA_ALERTS);
  await db.exec(SCHEMA_REQUESTS_GUARD);

  // The session's active profile. It lives on the row rather than in a cookie so
  // it cannot be edited in the browser, and it is nullable so a session created
  // before this column existed still resolves.
  const sessionColumns = (
    (await db.query("SELECT name FROM pragma_table_info('sessions')", [])) as { name: string }[]
  ).map((r) => r.name);
  if (!sessionColumns.includes("active_role")) {
    await db.exec("ALTER TABLE sessions ADD COLUMN active_role TEXT");
  }

  // ROLE MEMBERSHIP BACKFILL — the one-way, idempotent move off the legacy
  // single-role column.
  //
  // Every existing account gets a membership for the role it already had, so no
  // account loses the access it had and no data moves between user ids. Running
  // it again is a no-op because of the primary key, which is what makes it safe
  // on every boot. The `users.role` column itself is left in place so an older
  // binary could still open the file, but nothing reads it for authorization.
  await db.exec(
    `INSERT OR IGNORE INTO user_roles (user_id, role, is_primary, created_at)
     SELECT id, role, 1, created_at FROM users`,
  );
  // An account must always have at least one role, or it could authenticate and
  // then have no dashboard at all. Anything without a membership inherits its
  // legacy role; if even that is unusable the account is pinned to 'requester',
  // the least-privileged role, which cannot be escalated from there.
  await db.exec(
    `INSERT OR IGNORE INTO user_roles (user_id, role, is_primary, created_at)
     SELECT u.id,
            CASE WHEN u.role IN ('donor','requester','volunteer','admin')
                 THEN u.role ELSE 'requester' END,
            1,
            u.created_at
       FROM users u
      WHERE NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id)`,
  );
  // Exactly one primary per account, so "where do I land?" is never ambiguous.
  await db.exec(
    `UPDATE user_roles SET is_primary = 0
      WHERE is_primary = 1
        AND user_id IN (SELECT user_id FROM user_roles
                         GROUP BY user_id HAVING COUNT(*) > 1)`,
  );

  // The acceptance index is dropped and recreated on every boot. That is what
  // upgrades a database written before the index was scoped to request_id alone:
  // `CREATE UNIQUE INDEX IF NOT EXISTS` would silently keep the old, weaker
  // definition and two different donors could both be accepted for one request.
  await db.exec("DROP INDEX IF EXISTS donor_alerts_one_acceptance_idx");

  // Columns added after the first release. `CREATE TABLE IF NOT EXISTS` skips a
  // table that already exists, so a database created by an older build keeps
  // its original shape unless the new columns are added here. Each ALTER is
  // guarded by a check against PRAGMA table_info, so re-running is free.
  for (const [table, column, ddl] of [
    ["blood_requests", "cancelled_at", "ALTER TABLE blood_requests ADD COLUMN cancelled_at TEXT"],
    ["blood_requests", "fulfilled_at", "ALTER TABLE blood_requests ADD COLUMN fulfilled_at TEXT"],
  ] as const) {
    const present = (await db.queryOne(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`, [table, column]));
    if (!present) await db.exec(ddl);
  }

  // The request's location is no longer a hospital: it is the general area where
  // the blood is needed. A request that has never been created has no hospital
  // columns, so nothing to do; one written by an older build does, and its data
  // is preserved — `hospital_locality` was already the general area, and the
  // hospital name is kept as the locality's own text only when there is no
  // better value, so a request never silently loses its location.
  const requestColumns = (
    (await db.query("SELECT name FROM pragma_table_info('blood_requests')", [])) as {
      name: string;
    }[]
  ).map((r) => r.name);
  if (requestColumns.includes("hospital_locality")) {
    // A table cannot be rebuilt while a trigger on it exists, and the guard
    // below is recreated from SCHEMA_HEAD on the next boot anyway.
    await db.exec("DROP TRIGGER IF EXISTS blood_requests_terminal_guard");
    await db.exec("ALTER TABLE blood_requests RENAME TO blood_requests_legacy");
    await db.exec(SCHEMA_REQUESTS);
    await db.exec(
      `INSERT INTO blood_requests
         (id, requester_id, requester_name, requester_phone, blood_group,
          blood_component, units, locality, urgency, required_by, note, status,
          latitude, longitude, created_at, updated_at, cancelled_at, fulfilled_at)
       SELECT id, requester_id, requester_name, requester_phone, blood_group,
              blood_component, units,
              COALESCE(NULLIF(hospital_locality, ''), NULLIF(hospital_name, ''), 'Unknown area'),
              urgency, required_by, note, status, latitude, longitude,
              created_at, updated_at, cancelled_at, fulfilled_at
         FROM blood_requests_legacy`,
    );
    await db.exec("DROP TABLE blood_requests_legacy");
    // The index names are unchanged, but they went with the old table.
    await db.exec(
      `CREATE INDEX IF NOT EXISTS blood_requests_requester_idx
         ON blood_requests(requester_id, created_at DESC)`,
    );
    await db.exec(
      `CREATE INDEX IF NOT EXISTS blood_requests_active_idx
         ON blood_requests(status, required_by)`,
    );
    await db.exec(SCHEMA_REQUESTS_GUARD);
  }

  // `donor_alerts.status` also changed vocabulary: an answer is recorded as
  // 'responded' with the outcome in `response`, so a declined alert stays
  // declined. The old CHECK accepted 'accepted'/'declined' as STATUSES, which
  // mixed the state with the answer and left the workflow unable to mark an
  // answered alert. CHECK constraints cannot be altered in place, and a
  // migrated table must keep its rows, so the rows are normalised to the new
  // vocabulary first and the table is then rebuilt. Guarded by a probe of the
  // live constraint text, so a database already on the new shape is untouched.
  const statusCheck = String(
    (
      (await db.queryOne("SELECT sql FROM sqlite_master WHERE type='table' AND name='donor_alerts'", [])) as { sql?: string } | undefined
    )?.sql ?? "",
  );
  if (statusCheck.includes("'accepted'")) {
    // The rows are translated in the SELECT, not by an UPDATE first: the OLD
    // CHECK is still in force at that point and would refuse the new
    // 'responded' value outright. Renaming the old table out of the way,
    // creating the corrected one, and copying across is what makes this safe.
    await db.exec("ALTER TABLE donor_alerts RENAME TO donor_alerts_legacy");
    await db.exec(SCHEMA_ALERTS);
    await db.exec(
      `INSERT INTO donor_alerts
         (id, request_id, donor_id, ring_index, ring_km, status, response,
          due_at, responded_at, reminder_sent_at, created_at)
       SELECT id, request_id, donor_id, ring_index, ring_km,
              CASE WHEN response IS NOT NULL THEN 'responded' ELSE status END,
              response, due_at, responded_at, reminder_sent_at, created_at
         FROM donor_alerts_legacy`,
    );
    await db.exec("DROP TABLE donor_alerts_legacy");
  }

  // Created last, once donor_alerts is guaranteed to be in its final shape.
  await db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS donor_alerts_one_acceptance_idx
       ON donor_alerts(request_id) WHERE response = 'accepted'`,
  );

  await db.run("INSERT OR IGNORE INTO platform_settings (id, updated_at) VALUES (1, ?)", [now]);
  await db.run("INSERT OR IGNORE INTO platform_safety_limits (id, updated_at) VALUES (1, ?)", [now]);

  // The one documented demo administrator (see `@/lib/demo-account`).
  //
  // Public sign-up cannot create an admin, so without this the entire admin
  // area would be unreachable — and the login page advertises these very
  // credentials. It is seeded ONLY when the address is absent, so a password
  // changed through the app is never reset by a restart, and re-running this
  // migration is free. Hashing happens once, on first creation.
  const demoSeeded = (await db.queryOne("SELECT id FROM users WHERE email = ?", [DEMO_ADMIN_EMAIL]));
  if (!demoSeeded) {
    const { hash } = hashPassword(DEMO_ADMIN_PASSWORD);
    const id = randomUUID();
    await db.run(`INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?)`, [id, DEMO_ADMIN_EMAIL, hash, DEMO_ADMIN_NAME, now, now]);
    // The role-membership backfill above has already run, so the demo admin —
    // created after it — must be given its membership explicitly. Without this
    // the account would sign in with no roles at all and lose admin access.
    await db.run(`INSERT OR IGNORE INTO user_roles (user_id, role, is_primary, created_at)
         VALUES (?, 'admin', 1, ?)`, [id, now]);
  }
}

export const DB_FILE = DB_PATH;

