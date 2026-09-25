/**
 * RaktSetu local data store — the single source of truth in local/demo mode.
 *
 * WHY THIS EXISTS
 *
 * The application was originally backed by Supabase, which made it unusable
 * without hosted credentials. This store replaces that dependency for the
 * normal user-facing experience: everything the demo needs is persisted in the
 * browser, so a fresh visitor can register, request blood, alert donors and
 * browse drives with no server, account or key.
 *
 * DESIGN RULES
 *
 * 1. ONE store. No component touches localStorage directly; everything goes
 *    through this module, so a schema change has exactly one migration point.
 * 2. Versioned. A stored blob from an older shape is discarded rather than
 *    half-read, because a partially-understood record is worse than none.
 * 3. Corruption-tolerant. JSON.parse failures, non-object payloads and
 *    missing keys all fall back to a valid empty state instead of throwing —
 *    a demo must never white-screen because a key was half-written.
 * 4. Read-only snapshots. Handlers return copies, so a caller cannot mutate
 *    stored state by accident and desynchronise the next render.
 */

export const LOCAL_SCHEMA_VERSION = 1;

import {
  SAFETY_LIMITS_DEFAULTS,
  SETTINGS_BOUNDS,
} from "@/lib/constants";
import { DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD } from "../demo-account";
import { makeCredential, verifyPassword } from "./crypto";
export const STORE_KEY = "raktsetu.local.v1";
export const SESSION_KEY = "raktsetu.session.v1";

export type LocalRole = "donor" | "requester" | "volunteer" | "admin";

export interface LocalUser {
  id: string;
  email: string;
  /**
   * Credential material.
   *
   * These replaced a plaintext `password` field, which meant every account's
   * password sat in readable localStorage. `password_hash` is a salted,
   * iterated SHA-256 (see ./crypto) and the raw password is never stored.
   *
   * This is honest prototype-grade protection, not server-grade security:
   * there is no server, so anyone who can read this data can still change it.
   * It removes the plain-text credential; it does not create a trust boundary.
   */
  password_salt: string;
  password_hash: string;
  /**
   * Present ONLY on rows written by an older build, which stored the password
   * itself. Read once so that account can sign in, then immediately replaced by
   * a hash and removed. Never written by new code.
   */
  password?: string;
  full_name: string;
  role: LocalRole;
  status: "active" | "suspended";
  created_at: string;
  updated_at: string;
}

export interface LocalDonorProfile {
  user_id: string;
  blood_group: string;
  locality: string;
  phone: string;
  availability: "available" | "temporarily_unavailable";
  last_donation_date: string | null;
  donation_count: number;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  updated_at: string;
}

export interface LocalVolunteerProfile {
  user_id: string;
  locality: string;
  phone: string;
  available: boolean;
  created_at: string;
  updated_at: string;
}

export type LocalRequestStatus = "active" | "fulfilled" | "cancelled" | "expired";
export type LocalUrgency = "routine" | "urgent" | "critical";
export type LocalComponent = "whole_blood" | "platelets";

export interface LocalBloodRequest {
  id: string;
  requester_id: string;
  requester_name: string;
  requester_phone: string;
  blood_group: string;
  blood_component: LocalComponent;
  units: number;
  hospital_name: string;
  hospital_locality: string;
  urgency: LocalUrgency;
  required_by: string;
  note: string | null;
  status: LocalRequestStatus;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  updated_at: string;
}

export interface LocalDonorAlert {
  id: string;
  request_id: string;
  donor_id: string;
  ring_index: number;
  ring_km: number;
  status: "queued" | "sent" | "opened" | "responded" | "expired";
  response: "accepted" | "declined" | null;
  responded_at: string | null;
  accepted_at: string | null;
  contact_shared_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocalRingProgress {
  request_id: string;
  ring_index: number;
  ring_km: number;
  started_at: string;
  finished_at: string | null;
  outcome: "accepted" | "request_closed" | "rings_exhausted" | null;
}

export interface LocalNotification {
  id: number;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  request_id: string | null;
  alert_id: string | null;
  drive_id: string | null;
  dedupe_key: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface LocalDonation {
  id: string;
  donor_id: string;
  request_id: string | null;
  drive_id: string | null;
  donated_on: string;
  blood_component: LocalComponent;
  units: number;
  created_at: string;
}

export interface LocalDrive {
  id: string;
  title: string;
  organization: string;
  drive_date: string;
  starts_at: string;
  ends_at: string;
  venue: string;
  locality: string;
  description: string | null;
  target_donors: number | null;
  status: "upcoming" | "ongoing" | "completed" | "cancelled";
  published: boolean;
  created_at: string;
  updated_at: string;
}

export interface LocalDriveRegistration {
  id: string;
  drive_id: string;
  donor_id: string;
  status: "registered" | "checked_in" | "participated" | "cancelled";
  registered_at: string;
  updated_at: string;
}

export interface LocalReport {
  id: string;
  request_id: string;
  reporter_id: string;
  reason: string;
  details: string | null;
  status: "open" | "under_review" | "resolved" | "dismissed";
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocalAssistance {
  id: string;
  request_id: string;
  volunteer_id: string;
  status: "offered" | "withdrawn";
  created_at: string;
  updated_at: string;
}

export interface LocalNotificationPreferences {
  user_id: string;
  drive_updates: boolean;
  donor_reminders: boolean;
  recognition_updates: boolean;
  created_at: string;
  updated_at: string;
}

export interface LocalAuditEvent {
  id: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  created_at: string;
}

/** The complete persisted shape. Adding a key here is a schema change. */
export interface LocalDatabase {
  users: LocalUser[];
  donor_profiles: LocalDonorProfile[];
  volunteer_profiles: LocalVolunteerProfile[];
  blood_requests: LocalBloodRequest[];
  donor_alerts: LocalDonorAlert[];
  ring_progress: LocalRingProgress[];
  notifications: LocalNotification[];
  donation_history: LocalDonation[];
  campus_blood_drives: LocalDrive[];
  campus_drive_registrations: LocalDriveRegistration[];
  request_reports: LocalReport[];
  request_assistance: LocalAssistance[];
  notification_preferences: LocalNotificationPreferences[];
  audit_events: LocalAuditEvent[];
  platform_settings: LocalPlatformSettings[];
  platform_safety_limits: LocalSafetyLimits[];
  next_notification_id: number;
}

export interface LocalSession {
  user_id: string;
  signed_in_at: string;
}

/**
 * The single row of platform settings — ring distances and timing, the
 * application-level donation interval, and the reminder lead times.
 *
 * Defaults reproduce the ring engine's previous hardcoded values exactly, so an
 * untouched install behaves identically to before these became configurable.
 */
export interface LocalPlatformSettings {
  id: number;
  alert_rings_km: number[];
  alert_window_minutes: number;
  alert_due_at_offset_minutes: number;
  donation_interval_days: number;
  max_alert_rings: number;
  cooldown_reminder_lead_days: number;
  donor_alert_reminder_hours: number;
  drive_reminder_window_hours: number;
  updated_at: string;
}

/** The single row of anti-abuse limits, read by the store's guard functions. */
export interface LocalSafetyLimits {
  id: number;
  max_active_requests_per_requester: number;
  min_request_interval_seconds: number;
  max_requests_per_hour: number;
  max_reports_per_day: number;
  max_alert_responses_per_minute: number;
  updated_at: string;
}

function defaultPlatformSettings(): LocalPlatformSettings {
  return {
    id: 1,
    alert_rings_km: [3, 7, 15],
    alert_window_minutes: 10,
    alert_due_at_offset_minutes: 120,
    donation_interval_days: 90,
    max_alert_rings: 5,
    cooldown_reminder_lead_days: 3,
    donor_alert_reminder_hours: 24,
    drive_reminder_window_hours: 48,
    updated_at: nowIso(),
  };
}

function defaultSafetyLimits(): LocalSafetyLimits {
  return {
    id: 1,
    max_active_requests_per_requester: SAFETY_LIMITS_DEFAULTS.maxActiveRequestsPerRequester,
    min_request_interval_seconds: SAFETY_LIMITS_DEFAULTS.minRequestIntervalSeconds,
    max_requests_per_hour: SAFETY_LIMITS_DEFAULTS.maxRequestsPerHour,
    max_reports_per_day: SAFETY_LIMITS_DEFAULTS.maxReportsPerDay,
    max_alert_responses_per_minute: SAFETY_LIMITS_DEFAULTS.maxAlertResponsesPerMinute,
    updated_at: nowIso(),
  };
}

/**
 * The live settings row, with every field sanitised.
 *
 * Returns a fresh valid object on missing, malformed or absurd values rather
 * than throwing, so a corrupted row can never stop the ring engine running.
 * Out-of-range numbers fall back to the documented default instead of being
 * clamped silently to something an admin did not choose.
 */
/** Postgres' unique-violation SQLSTATE, returned so the existing actions'
 *  `dbError.code === UNIQUE_VIOLATION` branches actually fire again. */
export const UNIQUE_VIOLATION = "23505";

/**
 * Uniqueness rules the local store enforces on every insert.
 *
 * WHY THIS EXISTS
 *
 * These constraints used to live in SQL (UNIQUE indexes across migrations
 * 0004–0016). With the local store there was no equivalent, so they were only
 * ever checked in the UI layer — and a UI check is a read followed by a write,
 * which is not a guarantee. Worse, the actions defensively handle a
 * `UNIQUE_VIOLATION` (Postgres 23505) error code the local adapter never
 * produced, so that branch was dead code and duplicates slipped through.
 *
 * Enforcing them here means the guarantee is back: a duplicate drive
 * registration, a duplicate report, a second donation on the same day, or a
 * second alert to the same donor for one request now returns the same 23505 the
 * existing actions already know how to handle.
 *
 * NULL is never compared to NULL, matching SQL: a drive donation (request_id
 * null) and a request donation (drive_id null) are judged on their own key. This
 * mirrors SQL rather than an observed browser failure, and it is currently
 * defensive: every rule below starts with a non-null user/donor id, so the
 * all-null key cannot arise from a well-formed row. It is kept so a future rule
 * or a partial row cannot silently collide.
 */
const UNIQUE_CONSTRAINTS: Record<string, string[][]> = {
  // The emergency-alert guarantee: never alert one donor twice for one request,
  // however many times the engine runs or however far the rings widen.
  donor_alerts: [["request_id", "donor_id"]],
  // One registration per donor per drive.
  campus_drive_registrations: [["drive_id", "donor_id"]],
  // One report per reporter per request.
  request_reports: [["reporter_id", "request_id"]],
  // One donation per donor per request per day, per drive per day, and — the
  // rule added in migration 0016 — per donor per day overall, so a drive
  // donation and a request donation on the same date cannot both count.
  donation_history: [
    ["donor_id", "request_id", "donated_on"],
    ["donor_id", "drive_id", "donated_on"],
    ["donor_id", "donated_on"],
  ],
  // One assistance record per volunteer per request.
  request_assistance: [["request_id", "volunteer_id"]],
  // One preferences row per user.
  notification_preferences: [["user_id"]],
};

/**
 * Returns a description of the first violated unique rule, or null when the row
 * is acceptable. Exported so the adapter's enforcement and the test suite agree
 * on one single definition.
 */
export function findUniqueViolation(
  db: LocalDatabase,
  table: string,
  candidate: Record<string, unknown>,
): string | null {
  const rules = UNIQUE_CONSTRAINTS[table];
  if (!rules) return null;
  const rows = (db as unknown as Record<string, Record<string, unknown>[]>)[table] ?? [];
  for (const cols of rules) {
    // An all-null key cannot collide: SQL's NULL semantics, deliberately kept.
    const key = cols.map((c) => candidate[c]);
    if (key.every((v) => v === null || v === undefined)) continue;
    const clash = rows.some((r) => cols.every((c, i) => r[c] === key[i]));
    if (clash) return `${table} already has a row with the same ${cols.join(" + ")}`;
  }
  return null;
}

export function getPlatformSettings(): LocalPlatformSettings {
  const row = readDatabase().platform_settings[0];
  const base = defaultPlatformSettings();
  if (!row) return base;
  const int = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  };
  const rings = Array.isArray(row.alert_rings_km)
    ? row.alert_rings_km.filter((n) => Number.isInteger(n) && n >= 0 && n <= 500)
    : base.alert_rings_km;
  return {
    id: 1,
    // An empty or unusable ring list would silently disable emergency alerting,
    // so it falls back to the documented 3/7/15 rather than expanding nowhere.
    alert_rings_km: rings.length > 0 ? rings : base.alert_rings_km,
    alert_window_minutes: int(
      row.alert_window_minutes,
      SETTINGS_BOUNDS.windowMin,
      SETTINGS_BOUNDS.windowMax,
      base.alert_window_minutes,
    ),
    alert_due_at_offset_minutes: int(
      row.alert_due_at_offset_minutes,
      SETTINGS_BOUNDS.offsetMin,
      SETTINGS_BOUNDS.offsetMax,
      base.alert_due_at_offset_minutes,
    ),
    donation_interval_days: int(
      row.donation_interval_days,
      SETTINGS_BOUNDS.intervalMin,
      SETTINGS_BOUNDS.intervalMax,
      base.donation_interval_days,
    ),
    max_alert_rings: int(row.max_alert_rings, 1, 5, base.max_alert_rings),
    cooldown_reminder_lead_days: int(
      row.cooldown_reminder_lead_days,
      1,
      30,
      base.cooldown_reminder_lead_days,
    ),
    donor_alert_reminder_hours: int(
      row.donor_alert_reminder_hours,
      1,
      168,
      base.donor_alert_reminder_hours,
    ),
    drive_reminder_window_hours: int(
      row.drive_reminder_window_hours,
      1,
      168,
      base.drive_reminder_window_hours,
    ),
    updated_at:
      typeof row.updated_at === "string" ? row.updated_at : base.updated_at,
  };
}

/** The live anti-abuse limits, sanitised the same way as the settings row. */
export function getSafetyLimits(): LocalSafetyLimits {
  const row = readDatabase().platform_safety_limits[0];
  const base = defaultSafetyLimits();
  if (!row) return base;
  const int = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  };
  return {
    id: 1,
    max_active_requests_per_requester: int(
      row.max_active_requests_per_requester,
      1,
      50,
      base.max_active_requests_per_requester,
    ),
    min_request_interval_seconds: int(
      row.min_request_interval_seconds,
      0,
      86_400,
      base.min_request_interval_seconds,
    ),
    max_requests_per_hour: int(
      row.max_requests_per_hour,
      1,
      1000,
      base.max_requests_per_hour,
    ),
    max_reports_per_day: int(row.max_reports_per_day, 1, 1000, base.max_reports_per_day),
    max_alert_responses_per_minute: int(
      row.max_alert_responses_per_minute,
      1,
      1000,
      base.max_alert_responses_per_minute,
    ),
    updated_at:
      typeof row.updated_at === "string" ? row.updated_at : base.updated_at,
  };
}


/**
 * The built-in demo administrator.
 *
 * WHY THIS EXISTS
 *
 * `createUser` deliberately refuses to make an admin — a submitted `role=admin`
 * is rewritten to "requester" — which is the correct security property. But with
 * no backend there was then NO way for an admin to ever exist, so the entire
 * admin area (dashboard, requests, users, alerts, drives, reports, settings) was
 * unreachable. This is the safe, self-contained replacement: a single, fixed,
 * clearly-labelled demo account seeded into a fresh database.
 *
 * It is a DEMO credential for a local prototype, not a secret and not a real
 * account. It cannot be reached by signing up, by passing role=admin, or by any
 * request body — only a brand-new local database contains it, and the login page
 * says so plainly.
 */
// The credential itself lives in `@/lib/demo-account`, so the legacy browser
// store and the server database seed the SAME documented account. Re-exported
// here because this module is where the demo login has always been imported
// from — the login page and the local-stack checks both read it from here.
export { DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD };

/** The demo admin, present in a fresh database only. */
/**
 * The demo admin, present in a fresh database only.
 *
 * The credential is hashed once at module load and reused. `emptyDatabase()`
 * runs on every read, so hashing inside it would burn CPU per call for an
 * account that never changes.
 */
let demoCredential: { password_salt: string; password_hash: string } | null = null;
function demoAdmin(): LocalUser {
  if (!demoCredential) demoCredential = makeCredential(DEMO_ADMIN_PASSWORD);
  return {
    id: "user_demo_admin",
    email: DEMO_ADMIN_EMAIL,
    ...demoCredential,
    full_name: "Demo Administrator",
    role: "admin",
    status: "active",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

function emptyDatabase(): LocalDatabase {
  return {
    users: [demoAdmin()],
    donor_profiles: [],
    volunteer_profiles: [],
    blood_requests: [],
    donor_alerts: [],
    ring_progress: [],
    notifications: [],
    donation_history: [],
    campus_blood_drives: [],
    campus_drive_registrations: [],
    request_reports: [],
    request_assistance: [],
    notification_preferences: [],
    audit_events: [],
    // The two singleton configuration tables. These were previously missing,
    // which meant the admin settings page wrote to a table that did not exist:
    // the form reported success, nothing persisted, and the ring engine kept
    // using hardcoded values. Defaults below match current behaviour exactly.
    platform_settings: [defaultPlatformSettings()],
    platform_safety_limits: [defaultSafetyLimits()],
    next_notification_id: 1,
  };
}

const TABLE_NAMES = [
  "users",
  "donor_profiles",
  "volunteer_profiles",
  "blood_requests",
  "donor_alerts",
  "ring_progress",
  "notifications",
  "donation_history",
  "campus_blood_drives",
  "campus_drive_registrations",
  "request_reports",
  "request_assistance",
  "notification_preferences",
  "audit_events",
  // Configuration tables. These MUST be listed: coerce() rebuilds a database by
  // copying exactly these keys out of storage, so a table missing from this list
  // is silently reset to its default on every single read. That is how the
  // settings tables first went missing — an admin saved a change, saw "saved",
  // and the next read quietly threw it away.
  "platform_settings",
  "platform_safety_limits",
] as const;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/**
 * Coerces an arbitrary parsed payload into a valid database. Anything
 * unrecognised becomes an empty table rather than propagating.
 */
function coerce(raw: unknown): LocalDatabase {
  const base = emptyDatabase();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== LOCAL_SCHEMA_VERSION) return base;
  const data = obj.data;
  if (!data || typeof data !== "object") return base;
  const d = data as Record<string, unknown>;
  for (const table of TABLE_NAMES) {
    const rows = d[table];
    if (Array.isArray(rows)) {
      (base as unknown as Record<string, unknown>)[table] = rows;
    }
  }
  const nextId = d.next_notification_id;
  if (typeof nextId === "number" && Number.isFinite(nextId) && nextId > 0) {
    base.next_notification_id = Math.floor(nextId);
  }
  return base;
}

/** Reads the persisted database. Never throws. */
export function readDatabase(): LocalDatabase {
  if (!isBrowser()) return emptyDatabase();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyDatabase();
    return coerce(JSON.parse(raw));
  } catch {
    // Corrupt JSON: start clean rather than crash the whole app.
    return emptyDatabase();
  }
}

/** Writes the database. Quota/permission failures are swallowed by design. */
export function writeDatabase(db: LocalDatabase): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ version: LOCAL_SCHEMA_VERSION, data: db })
    );
  } catch {
    // Private mode or quota exceeded — the app still works this session.
  }
}

/** Read → mutate → write, in one step. */
export function updateDatabase<T>(fn: (db: LocalDatabase) => T): T {
  const db = readDatabase();
  const result = fn(db);
  writeDatabase(db);
  return result;
}

export function readSession(): LocalSession | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalSession;
    if (!parsed || typeof parsed.user_id !== "string" || !parsed.user_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSession(session: LocalSession | null): void {
  if (!isBrowser()) return;
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

/** A short, collision-resistant id. Not a security primitive. */
export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Deep copy for read-only snapshots. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Roles a visitor may pick for themselves. Admin is deliberately absent:
 *  it is provisioned out of band and can never be self-assigned here. */
const SELF_SERVICE_ROLES = ["donor", "requester", "volunteer"] as const;

export interface NewUserInput {
  role?: string;
  full_name?: string;
}

/**
 * Creates a local account and signs the new user in.
 *
 * The submitted role is sanitised against SELF_SERVICE_ROLES and anything else
 * falls back to "requester" — the same rewrite the database signup trigger
 * performed, so a hand-crafted request carrying role=admin still cannot create
 * an admin.
 */
export function createUser(
  email: string,
  password: string,
  input: NewUserInput = {},
): LocalUser {
  const normalizedEmail = email.trim().toLowerCase();
  const requested = (input.role ?? "").trim().toLowerCase();
  const role = (SELF_SERVICE_ROLES as readonly string[]).includes(requested)
    ? (requested as LocalUser["role"])
    : "requester";

  const existing = readDatabase().users.find(
    (u) => u.email.toLowerCase() === normalizedEmail,
  );
  if (existing) {
    throw new Error("An account with that email already exists.");
  }

  const user: LocalUser = {
    id: newId("user"),
    email: normalizedEmail,
    // Hashed immediately; the raw password is never stored.
    ...makeCredential(password),
    full_name: (input.full_name ?? "").trim(),
    role,
    status: "active",
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  updateDatabase((db) => {
    db.users.push(user);
    if (role === "donor") {
      db.donor_profiles.push({
        user_id: user.id,
        blood_group: "",
        locality: "",
        phone: "",
        last_donation_date: null,
        availability: "temporarily_unavailable",
        donation_count: 0,
        latitude: null,
        longitude: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }
    if (role === "volunteer") {
      db.volunteer_profiles.push({
        user_id: user.id,
        phone: "",
        locality: "",
        available: true,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }
  });

  writeSession({ user_id: user.id, signed_in_at: nowIso() });
  return user;
}

/**
 * Re-authenticates a local account.
 *
 * Returns null for both an unknown address and a wrong password, so this cannot
 * be used to discover which emails are registered. Password comparison is plain
 * equality on a value that lives only in this browser — see the note on
 * LocalUser.password.
 */
export type SignInFailure = "credentials" | "suspended";

/**
 * Re-authenticates a local account.
 *
 * Returns null for BOTH an unknown address, a wrong password, and a suspended
 * account. The suspended case is folded in deliberately: a low-level lookup
 * that handed back a suspended user would let any caller that forgot to
 * re-check `status` authenticate a disabled account.
 *
 * The specific "suspended" wording for the UI comes from signInDetailed, which
 * is the only path that distinguishes the reasons.
 */
export function signIn(email: string, password: string): LocalUser | null {
  const result = signInDetailed(email, password);
  return result.ok ? result.user : null;
}

/** The same check as signIn, but reports WHY it failed so the UI can be specific. */
export function signInDetailed(
  email: string,
  password: string,
): { ok: true; user: LocalUser } | { ok: false; reason: SignInFailure } {
  const user = readDatabase().users.find(
    (u) => u.email.toLowerCase() === email.trim().toLowerCase(),
  );
  if (!user) return { ok: false, reason: "credentials" };
  // Identical handling of "no such account" and "wrong password", so this cannot
  // be used to discover which addresses are registered.
  //
  // A row written by an older build may still carry a plaintext `password`; it
  // is accepted once and then upgraded to a hash in place, so upgrading the app
  // never locks anybody out of their own account.
  const matches =
    verifyPassword(password, user.password_hash) ||
    (typeof user.password === "string" && user.password === password);
  if (!matches) return { ok: false, reason: "credentials" };
  if (user.password !== undefined) upgradeLegacyCredential(user.id, password);
  if (user.status !== "active") return { ok: false, reason: "suspended" };
  writeSession({ user_id: user.id, signed_in_at: nowIso() });
  return { ok: true, user };
}

/**
 * Changes the signed-in account's password.
 *
 * REQUIRED: the previous implementation returned `{ error: null }` without
 * touching anything, so the reset form reported success and the user was then
 * locked out of the password they had just chosen. A silent no-op that claims
 * success is worse than an error.
 *
 * Returns false for a malformed/empty password so the caller can refuse it
 * rather than storing an unusable credential.
 */
export function setCurrentPassword(password: string): boolean {
  const session = readSession();
  if (!session) return false;
  if (typeof password !== "string" || password.length < 8) return false;
  const { password_salt, password_hash } = makeCredential(password);
  updateDatabase((db) => {
    const row = db.users.find((u) => u.id === session.user_id);
    if (!row) return;
    row.password_salt = password_salt;
    row.password_hash = password_hash;
    // Clear any legacy plaintext credential at the same time.
    delete row.password;
  });
  return true;
}

/**
 * Replaces a legacy plaintext credential with a hash, in place.
 *
 * Best-effort by design: if this write fails, the same account still signs in
 * through the legacy path next time, so a partial upgrade cannot become a
 * lockout.
 */
function upgradeLegacyCredential(userId: string, password: string): void {
  try {
    updateDatabase((db) => {
      const row = db.users.find((u) => u.id === userId);
      if (!row) return;
      const { password_salt, password_hash } = makeCredential(password);
      row.password_salt = password_salt;
      row.password_hash = password_hash;
      delete row.password;
    });
  } catch {
    // Ignored on purpose — see above.
  }
}

/**
 * Wipes local state. Only the explicit demo-reset control calls this — never
 * implicitly, so a refresh can never destroy a visitor's data.
 */
export function resetLocalData(): void {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(SESSION_KEY);
    document.cookie = "raktsetu.session=; Max-Age=0; path=/";
  } catch {
    // ignore
  }
}

