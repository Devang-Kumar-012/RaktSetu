/**
 * SQLite-backed implementation of the application's existing data-access seam.
 *
 * The UI and server actions already speak the Supabase-shaped API
 * (`.from(table).select().eq().order().range()` and `.rpc(name, args)`). Rather
 * than rewrite every page, this implements that SAME interface against
 * `src/lib/server/db.ts`, so the application talks to SQLite without changing
 * the pages.
 *
 * Two rules make this safe:
 *
 *  1. VALUES are always bound as parameters — never concatenated into SQL.
 *  2. IDENTIFIERS (table/column names) are matched against a strict allow-list
 *     before they reach a statement, so a crafted name cannot inject SQL.
 *
 * SERVER ONLY. This opens a file on disk; never import it from a client
 * component.
 */

import { getDb } from "./db";

/** Values `node:sqlite` will bind. Our params are `unknown` until bound. */
type Bindable = Parameters<ReturnType<typeof getDb>["prepare"]>[0] extends never
  ? never
  : string | number | bigint | Buffer | null;

export type Row = Record<string, unknown>;

export interface QueryResult<T = Row> {
  data: T | null;
  error: { message: string; code?: string } | null;
  /** Row count for `.select("*", { count: "exact" })`. */
  count?: number | null;
  [key: string]: unknown;
}

const ok = <T,>(data: T, extra: Partial<QueryResult<T>> = {}): QueryResult<T> => ({
  data,
  error: null,
  ...extra,
});
const fail = <T,>(message: string, code?: string): QueryResult<T> => ({
  data: null,
  error: { message, code },
});

/** Tables the application may touch. Anything else is a bug, not a query. */
const TABLES = new Set([
  "users", "profiles", "sessions", "donor_profiles", "volunteer_profiles",
  "blood_requests", "ring_progress", "donor_alerts", "donations",
  "notifications", "campus_blood_drives", "campus_drive_registrations",
  "request_reports", "request_assistance", "audit_events",
  "platform_settings", "platform_safety_limits",
]);

const USER_COLS = [
  "id", "email", "password_hash", "full_name", "role", "status", "created_at", "updated_at",
];
const SESSION_COLS = [
  "id", "user_id", "token_hash", "created_at", "expires_at", "revoked_at",
];
const DRIVER_COLS = [
  "id", "title", "organizer", "drive_date", "starts_at", "ends_at", "venue",
  "locality", "description", "target_units", "status", "published",
  "reminder_sent_at", "created_at", "updated_at",
];

/** Column allow-list per table. Used to validate every identifier. */
const COLUMNS: Record<string, string[]> = {
  users: USER_COLS,
  donor_profiles: [
    "user_id", "blood_group", "locality", "phone", "latitude", "longitude",
    "availability", "last_donation_date", "donation_count", "created_at", "updated_at",
  ],
  volunteer_profiles: ["user_id", "phone", "locality", "available", "created_at", "updated_at"],
  blood_requests: [
    "id", "requester_id", "requester_name", "requester_phone", "blood_group",
    "blood_component", "units", "hospital_name", "hospital_locality", "urgency",
    "required_by", "note", "status", "latitude", "longitude", "created_at", "updated_at",
  ],
  ring_progress: [
    "request_id", "ring_index", "started_at", "last_advanced_at", "finished_at", "outcome",
  ],
  donor_alerts: [
    "id", "request_id", "donor_id", "ring_index", "ring_km", "status", "response",
    "due_at", "responded_at", "reminder_sent_at", "created_at",
  ],
  donations: [
    "id", "donor_id", "request_id", "drive_id", "donated_on", "blood_component",
    "units", "created_at",
  ],
  notifications: [
    "id", "user_id", "kind", "title", "body", "request_id", "alert_id", "link",
    "read_at", "created_at", "dedupe_key",
  ],
  campus_blood_drives: DRIVER_COLS,
  campus_drive_registrations: [
    "id", "drive_id", "donor_id", "status", "created_at", "updated_at",
  ],
  request_reports: [
    "id", "request_id", "reporter_id", "reason", "note", "status", "created_at", "updated_at",
  ],
  request_assistance: [
    "id", "request_id", "volunteer_id", "status", "created_at", "updated_at",
  ],
  audit_events: ["id", "actor_id", "action", "entity", "entity_id", "metadata", "created_at"],
  platform_settings: [
    "id", "alert_rings_km", "alert_window_minutes", "alert_due_at_offset_minutes",
    "donation_interval_days", "max_alert_rings", "cooldown_reminder_lead_days",
    "donor_alert_reminder_hours", "drive_reminder_window_hours", "updated_at",
  ],
  platform_safety_limits: [
    "id", "max_requests_per_hour", "max_reports_per_hour", "max_alert_responses", "updated_at",
  ],
  sessions: SESSION_COLS,
};

/** Columns stored as 0/1 so the app can keep passing real booleans. */
const BOOL_COLUMNS = new Set(["published", "available"]);

function resolveTable(table: string): string | null {
  if (table === "profiles") return "users";
  return TABLES.has(table) ? table : null;
}

function cols(table: string): string[] {
  const t = resolveTable(table);
  return (t && COLUMNS[t]) || [];
}

function toStorage(value: unknown, column: string): unknown {
  if (value === undefined) return null;
  if (BOOL_COLUMNS.has(column) && typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function fromStorage(row: Row, table: string): Row {
  const out: Row = { ...row };
  for (const key of Object.keys(out)) {
    if (BOOL_COLUMNS.has(key)) out[key] = Number(out[key]) === 1;
  }
  if (resolveTable(table) === "users") {
    // Credential material must never leave the server.
    delete out.password_hash;
  }
  return out;
}

type Op = "eq" | "neq" | "in" | "gt" | "gte" | "lt" | "lte" | "like";

const SQL_OP: Record<Op, string> = {
  eq: "=", neq: "!=", in: "IN", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "LIKE",
};

interface Filter {
  column: string;
  value: unknown;
  op: Op;
}

/** Maps a SQLite constraint failure onto the codes the app already handles. */
function sqliteError(err: unknown): QueryResult {
  const message = err instanceof Error ? err.message : String(err);
  if (/UNIQUE constraint failed/i.test(message)) {
    return { data: null, error: { message: "duplicate", code: "23505" } };
  }
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return { data: null, error: { message: "not found", code: "23503" } };
  }
  if (/CHECK constraint failed|NOT NULL/i.test(message)) {
    return { data: null, error: { message: "invalid", code: "23514" } };
  }
  return { data: null, error: { message: "database error", code: "DBERR" } };
}

/**
 * The query builder.
 *
 * Mirrors the existing client adapter's chainable surface so existing callers
 * work unchanged. It is thenable (`await supabase.from(...)`) and also exposes
 * `.single()` / `.maybeSingle()`.
 */
export class SqlTableQuery implements PromiseLike<QueryResult> {
  private filters: Filter[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private limitTo: number | null = null;
  private offsetTo = 0;
  private mode: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private wantCount = false;
  private headOnly = false;

  constructor(readonly table: string) { }

  select(_c?: string, opts?: { count?: string; head?: boolean }): this {
    if (this.mode === "select") {
      this.wantCount = opts?.count === "exact";
      this.headOnly = Boolean(opts?.head);
    }
    return this;
  }
  insert(values: Row | Row[]): this { this.mode = "insert"; this.payload = values; return this; }
  upsert(values: Row | Row[]): this { this.mode = "upsert"; this.payload = values; return this; }
  update(values: Row): this { this.mode = "update"; this.payload = values; return this; }
  delete(_e?: unknown): this { this.mode = "delete"; return this; }

  private add(op: Op, column: string, value: unknown): this {
    this.filters.push({ column, value, op });
    return this;
  }
  eq(c: string, v: unknown) { return this.add("eq", c, v); }
  neq(c: string, v: unknown) { return this.add("neq", c, v); }
  in(c: string, v: unknown[]) { return this.add("in", c, v); }
  gt(c: string, v: unknown) { return this.add("gt", c, v); }
  gte(c: string, v: unknown) { return this.add("gte", c, v); }
  lt(c: string, v: unknown) { return this.add("lt", c, v); }
  lte(c: string, v: unknown) { return this.add("lte", c, v); }
  like(c: string, v: unknown) { return this.add("like", c, v); }
  order(c: string, o?: { ascending?: boolean }): this {
    this.orders.push({ column: c, ascending: o?.ascending ?? true });
    return this;
  }
  limit(n: number): this { this.limitTo = n; return this; }
  range(from: number, to: number): this {
    this.offsetTo = from;
    this.limitTo = to - from + 1;
    return this;
  }

  /** Builds the WHERE clause, binding every value as a parameter. */
  private where(): { sql: string; params: unknown[] } {
    const allowed = new Set(cols(this.table));
    const parts: string[] = [];
    const params: unknown[] = [];
    for (const f of this.filters) {
      if (!allowed.has(f.column)) continue; // unknown column: ignore, never inject
      if (f.op === "in") {
        const arr = Array.isArray(f.value) ? f.value : [];
        if (arr.length === 0) { parts.push("0 = 1"); continue; }
        parts.push(`"${f.column}" IN (${arr.map(() => "?").join(",")})`);
        for (const v of arr) params.push(toStorage(v, f.column));
        continue;
      }
      if (f.value === null) {
        // .eq(col, null) means IS NULL, matching the previous behaviour.
        parts.push(f.op === "neq" ? `"${f.column}" IS NOT NULL` : `"${f.column}" IS NULL`);
        continue;
      }
      parts.push(`"${f.column}" ${SQL_OP[f.op]} ?`);
      params.push(toStorage(f.value, f.column));
    }
    return { sql: parts.length ? " WHERE " + parts.join(" AND ") : "", params };
  }

  private orderBy(): string {
    const allowed = new Set(cols(this.table));
    const parts = this.orders
      .filter((o) => allowed.has(o.column))
      .map((o) => `"${o.column}" ${o.ascending ? "ASC" : "DESC"}`);
    return parts.length ? " ORDER BY " + parts.join(", ") : "";
  }


  private runSelect(): QueryResult {
    const table = resolveTable(this.table);
    if (!table) return fail(`Unknown table: ${this.table}`, "42P01");
    const db = getDb();
    const { sql: where, params } = this.where();
    const bind = params as Bindable[];

    let count: number | null = null;
    if (this.wantCount) {
      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM "${table}"${where}`)
        .get(...bind) as { n: number };
      count = Number(row.n);
    }
    if (this.headOnly) return ok([] as unknown as Row, { count });

    const limit = this.limitTo !== null ? ` LIMIT ${Math.max(0, this.limitTo)}` : "";
    const offset = this.limitTo !== null && this.offsetTo > 0 ? ` OFFSET ${this.offsetTo}` : "";
    const rows = db
      .prepare(`SELECT * FROM "${table}"${where}${this.orderBy()}${limit}${offset}`)
      .all(...bind) as Row[];
    return ok(rows.map((r) => fromStorage(r, this.table)) as unknown as Row, { count });
  }

  private runInsert(upsert: boolean): QueryResult {
    const table = resolveTable(this.table);
    if (!table) return fail(`Unknown table: ${this.table}`, "42P01");
    const allowed = new Set(cols(this.table));
    const db = getDb();
    const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]) as Row[];
    const out: Row[] = [];
    try {
      for (const row of incoming) {
        const rec: Row = { ...row };
        if (!rec.created_at) rec.created_at = new Date().toISOString();
        if (allowed.has("updated_at")) rec.updated_at = new Date().toISOString();
        const keys = Object.keys(rec).filter((k) => allowed.has(k));
        if (keys.length === 0) continue;
        const placeholders = keys.map(() => "?").join(",");
        const stmt = `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${placeholders})`;
        try {
          const info = db
            .prepare(stmt)
            .run(...(keys.map((k) => toStorage(rec[k], k)) as Bindable[]));
          if (table === "donor_alerts" && info.lastInsertRowid) {
            rec.id = Number(info.lastInsertRowid);
          }
          out.push(fromStorage(rec, this.table));
        } catch (err) {
          if (!upsert) throw err;
          // Upsert: on a primary-key conflict, update instead of failing.
          const key = table === "donor_profiles" || table === "volunteer_profiles" ? "user_id" : "id";
          if (!allowed.has(key)) throw err;
          const setKeys = keys.filter((k) => k !== key);
          if (setKeys.length) {
            db.prepare(
              `UPDATE "${table}" SET ${setKeys.map((k) => `"${k}" = ?`).join(", ")} WHERE "${key}" = ?`
            ).run(
              ...(setKeys.map((k) => toStorage(rec[k], k)) as Bindable[]),
              toStorage(rec[key], key) as Bindable
            );
          }
          out.push(fromStorage(rec, this.table));
        }
      }
    } catch (err) {
      return sqliteError(err);
    }
    return ok(out as unknown as Row);
  }

  private runUpdate(): QueryResult {
    const table = resolveTable(this.table);
    if (!table) return fail(`Unknown table: ${this.table}`, "42P01");
    const allowed = new Set(cols(this.table));
    const patch = (this.payload ?? {}) as Row;
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!allowed.has(k)) continue;
      sets.push(`"${k}" = ?`);
      params.push(toStorage(v, k));
    }
    if (sets.length === 0) return ok([] as unknown as Row);
    const { sql: where, params: wp } = this.where();
    try {
      const info = getDb()
        .prepare(`UPDATE "${table}" SET ${sets.join(", ")}${where}`)
        .run(...(params as Bindable[]), ...(wp as Bindable[]));
      return ok({ updated: Number(info.changes) } as Row);
    } catch (err) {
      return sqliteError(err);
    }
  }

  private runDelete(): QueryResult {
    const table = resolveTable(this.table);
    if (!table) return fail(`Unknown table: ${this.table}`, "42P01");
    const { sql: where, params } = this.where();
    try {
      const info = getDb()
        .prepare(`DELETE FROM "${table}"${where}`)
        .run(...(params as Bindable[]));
      return ok({ deleted: Number(info.changes) } as Row);
    } catch (err) {
      return sqliteError(err);
    }
  }

  private execute(): QueryResult {
    switch (this.mode) {
      case "select": return this.runSelect();
      case "insert": return this.runInsert(false);
      case "upsert": return this.runInsert(true);
      case "update": return this.runUpdate();
      case "delete": return this.runDelete();
    }
  }

  then<R1 = QueryResult, R2 = never>(
    onfulfilled?: ((value: QueryResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    let value: QueryResult;
    try {
      value = this.execute();
    } catch (err) {
      value = sqliteError(err);
    }
    return Promise.resolve(value).then(onfulfilled, onrejected);
  }

  async single(): Promise<QueryResult> {
    this.limitTo = 1;
    const r = await this;
    if (r.error) return r;
    const rows = (r.data ?? []) as Row[];
    if (rows.length === 0) return fail("No rows found", "PGRST116");
    return ok(rows[0], { count: r.count });
  }

  async maybeSingle(): Promise<QueryResult> {
    this.limitTo = 2;
    const r = await this;
    if (r.error) return r;
    const rows = (r.data ?? []) as Row[];
    return ok(rows[0] ?? null, { count: r.count });
  }
}

export function createSqlClient() {
  return {
    from: (table: string) => new SqlTableQuery(table),
    rpc: (name: string, args: Record<string, unknown> = {}) =>
      Promise.resolve({ data: null, error: { message: `Unknown rpc: ${name}` } }),
  };
}

