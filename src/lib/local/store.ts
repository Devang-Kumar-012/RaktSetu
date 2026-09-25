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
export const STORE_KEY = "raktsetu.local.v1";
export const SESSION_KEY = "raktsetu.session.v1";

export type LocalRole = "donor" | "requester" | "volunteer" | "admin";

export interface LocalUser {
  id: string;
  email: string;
  /**
   * A local prototype credential, NOT a password hash. It exists only so the
   * demo can re-authenticate on refresh. It is stored in the visitor's own
   * browser, grants nothing on any server, and must never be reused as a
   * security control.
   */
  password: string;
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
  next_notification_id: number;
}

export interface LocalSession {
  user_id: string;
  signed_in_at: string;
}


function emptyDatabase(): LocalDatabase {
  return {
    users: [],
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
    password,
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
export function signIn(email: string, password: string): LocalUser | null {
  const user = readDatabase().users.find(
    (u) => u.email.toLowerCase() === email.trim().toLowerCase(),
  );
  if (!user || user.password !== password) return null;
  writeSession({ user_id: user.id, signed_in_at: nowIso() });
  return user;
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

