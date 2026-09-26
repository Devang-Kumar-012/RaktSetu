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
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  DEMO_ADMIN_EMAIL,
  DEMO_ADMIN_NAME,
  DEMO_ADMIN_PASSWORD,
} from "@/lib/demo-account";
import { hashPassword } from "./password";

/**
 * Where the database lives: `./data/raktsetu.db` beside the app, which is
 * correct for a persistent Node host. This is the single place to change it if
 * the platform mounts its volume elsewhere.
 *
 * There is deliberately NO environment lookup here. The application is
 * self-contained and reads no configuration at all, an invariant asserted
 * across every file in `src/` by `scripts/check-invariants.ts`. Never sent to
 * the browser.
 */
const DB_PATH = join(process.cwd(), "data", "raktsetu.db");

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
    DatabaseSyncCtor = require_("node:sqlite").DatabaseSync as typeof DatabaseSync;
  }
  return DatabaseSyncCtor;
}

let db: DatabaseSync | null = null;

/** The open connection, created and migrated on first use. */
export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new (sqliteDatabase())(DB_PATH);
  // WAL lets readers proceed during a write and survives restarts with the
  // file. NORMAL is the right durability trade for SQLite at this scale.
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

/** For tests and scripts that need a clean handle. */
export function closeDb(): void {
  db?.close();
  db = null;
}

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
  revoked_at TEXT
);
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

CREATE TABLE IF NOT EXISTS blood_requests (
  id                TEXT PRIMARY KEY,
  requester_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_name    TEXT NOT NULL,
  requester_phone   TEXT NOT NULL,
  blood_group       TEXT NOT NULL,
  blood_component   TEXT NOT NULL,
  units             INTEGER NOT NULL CHECK (units > 0),
  hospital_name     TEXT NOT NULL,
  hospital_locality TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS blood_requests_requester_idx
  ON blood_requests(requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS blood_requests_active_idx
  ON blood_requests(status, required_by);

-- Terminal states are terminal. Enforced by the DATABASE, not by a button:
-- a row may only leave 'active' once, and a closed request can never be
-- reopened or re-closed. This is the same rule the Postgres CHECK/trigger
-- pair expressed, and it is what makes a racing cancel/fulfil/expiry lose
-- cleanly instead of double-writing a terminal state.
CREATE TRIGGER IF NOT EXISTS blood_requests_terminal_guard
BEFORE UPDATE OF status ON blood_requests
FOR EACH ROW WHEN OLD.status <> 'active' AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'a closed request cannot change status');
END;

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
function migrate(conn: DatabaseSync): void {
  conn.exec(SCHEMA_HEAD);
  conn.exec(SCHEMA_TAIL);
  const now = new Date().toISOString();

  conn.exec(SCHEMA_ALERTS);

  // The acceptance index is dropped and recreated on every boot. That is what
  // upgrades a database written before the index was scoped to request_id alone:
  // `CREATE UNIQUE INDEX IF NOT EXISTS` would silently keep the old, weaker
  // definition and two different donors could both be accepted for one request.
  conn.exec("DROP INDEX IF EXISTS donor_alerts_one_acceptance_idx");

  // Columns added after the first release. `CREATE TABLE IF NOT EXISTS` skips a
  // table that already exists, so a database created by an older build keeps
  // its original shape unless the new columns are added here. Each ALTER is
  // guarded by a check against PRAGMA table_info, so re-running is free.
  for (const [table, column, ddl] of [
    ["blood_requests", "cancelled_at", "ALTER TABLE blood_requests ADD COLUMN cancelled_at TEXT"],
    ["blood_requests", "fulfilled_at", "ALTER TABLE blood_requests ADD COLUMN fulfilled_at TEXT"],
  ] as const) {
    const present = conn
      .prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`)
      .get(table, column);
    if (!present) conn.exec(ddl);
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
      conn
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='donor_alerts'",
        )
        .get() as { sql?: string } | undefined
    )?.sql ?? "",
  );
  if (statusCheck.includes("'accepted'")) {
    // The rows are translated in the SELECT, not by an UPDATE first: the OLD
    // CHECK is still in force at that point and would refuse the new
    // 'responded' value outright. Renaming the old table out of the way,
    // creating the corrected one, and copying across is what makes this safe.
    conn.exec("ALTER TABLE donor_alerts RENAME TO donor_alerts_legacy");
    conn.exec(SCHEMA_ALERTS);
    conn.exec(
      `INSERT INTO donor_alerts
         (id, request_id, donor_id, ring_index, ring_km, status, response,
          due_at, responded_at, reminder_sent_at, created_at)
       SELECT id, request_id, donor_id, ring_index, ring_km,
              CASE WHEN response IS NOT NULL THEN 'responded' ELSE status END,
              response, due_at, responded_at, reminder_sent_at, created_at
         FROM donor_alerts_legacy`,
    );
    conn.exec("DROP TABLE donor_alerts_legacy");
  }

  // Created last, once donor_alerts is guaranteed to be in its final shape.
  conn.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS donor_alerts_one_acceptance_idx
       ON donor_alerts(request_id) WHERE response = 'accepted'`,
  );

  conn
    .prepare("INSERT OR IGNORE INTO platform_settings (id, updated_at) VALUES (1, ?)")
    .run(now);
  conn
    .prepare("INSERT OR IGNORE INTO platform_safety_limits (id, updated_at) VALUES (1, ?)")
    .run(now);

  // The one documented demo administrator (see `@/lib/demo-account`).
  //
  // Public sign-up cannot create an admin, so without this the entire admin
  // area would be unreachable — and the login page advertises these very
  // credentials. It is seeded ONLY when the address is absent, so a password
  // changed through the app is never reset by a restart, and re-running this
  // migration is free. Hashing happens once, on first creation.
  const demoSeeded = conn
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(DEMO_ADMIN_EMAIL);
  if (!demoSeeded) {
    const { hash } = hashPassword(DEMO_ADMIN_PASSWORD);
    conn
      .prepare(
        `INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?)`
      )
      .run(randomUUID(), DEMO_ADMIN_EMAIL, hash, DEMO_ADMIN_NAME, now, now);
  }
}

export const DB_FILE = DB_PATH;

