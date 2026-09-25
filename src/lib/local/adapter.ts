/**
 * A drop-in stand-in for the Supabase client used across the app.
 *
 * The application was written against a small slice of the Supabase API:
 * `.from(table)` with a query-builder chain, `.rpc(name, args)`, and `.auth.*`.
 * Rather than rewriting every page and server action, this adapter implements
 * exactly that slice against the local store, so the existing UI and actions
 * keep working with no backend at all.
 *
 * It is NOT a database and makes no security claim. Everything lives in one
 * visitor's own browser; "authorization" here means the store is asked only for
 * the rows belonging to this user, not that a server enforced a policy.
 */

import {
  closeProcessForRequest,
  expandAlertRings,
  recordDonation,
  respondToAlert,
  revealAcceptedDonors,
  RING_KM,
  setRequestStatus,
} from "./engine";
import {
  clone,
  createUser,
  newId,
  nowIso,
  readDatabase,
  readSession,
  signIn,
  updateDatabase,
  writeSession,
  type LocalUser,
} from "./store";

/**
 * Row type used at the adapter seam.
 *
 * `any` here is deliberate and matches what the Supabase client returned: the
 * generated row types were untyped at this boundary, and every call site
 * already casts to a domain type (`as DonorProfile`, `as BloodRequest`, …).
 * Strong typing lives one layer down, in src/lib/local/store.ts, which is where
 * the shapes are actually defined and checked.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = any;

export interface QueryResult<T = Row> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

const ok = <T,>(data: T): QueryResult<T> => ({ data, error: null });
const fail = <T,>(message: string, code?: string): QueryResult<T> => ({
  data: null,
  error: { message, code },
});

/** The signed-in user, or null. Derived from the local session. */
export function currentUser(): LocalUser | null {
  const session = readSession();
  if (!session) return null;
  return readDatabase().users.find((u) => u.id === session.user_id) ?? null;
}

/**
 * Mirrors the session into a cookie so server components and middleware can
 * still tell whether somebody is signed in. Readable by design — it holds only
 * a user id, and it authorises nothing on its own.
 */
function syncSessionCookie(userId: string | null): void {
  if (typeof document === "undefined") return;
  try {
    if (userId) {
      document.cookie = `raktsetu.session=${encodeURIComponent(userId)}; path=/; max-age=31536000; samesite=lax`;
    } else {
      document.cookie = "raktsetu.session=; path=/; max-age=0";
    }
  } catch {
    // ignore
  }
}

interface Filter {
  column: string;
  value: unknown;
  op: "eq" | "neq" | "in" | "gt" | "gte" | "lt" | "lte" | "like";
}

/** Coerces a PostgREST filter literal into the type it represents. */
function coerceValue(raw: string): unknown {
  const v = raw.trim();
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith("[") || v.startsWith("{")) {
    return v.replace(/[[\]{}]/g, "").split(",").map((s) => s.trim());
  }
  return v;
}

class TableQuery {
  private filters: Filter[] = [];
  private orderBy: { column: string; ascending: boolean }[] = [];
  private limitTo: number | null = null;
  private rangeFrom = 0;
  private rangeTo: number | null = null;
  private mode: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private headOnly = false;
  private wantsCount = false;

  constructor(private readonly table: string) {}

  select(
    _columns?: string,
    options?: { count?: "exact" | "planned" | "estimated"; head?: boolean },
  ): this {
    if (this.mode === "select") {
      this.wantsCount = options?.count === "exact";
      this.headOnly = options?.head === true;
    }
    return this;
  }
  insert(
    values: Row | Row[],
    _options?: { onConflict?: string },
  ): this {
    this.mode = "insert";
    this.payload = values;
    return this;
  }
  upsert(
    values: Row | Row[],
    _options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): this {
    this.mode = "upsert";
    this.payload = values;
    return this;
  }
  update(values: Row): this {
    this.mode = "update";
    this.payload = values;
    return this;
  }
  delete(_eq: unknown): this {
    this.mode = "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, value, op: "eq" });
    return this;
  }
  /** PostgREST `is` — null / true / false checks. */
  is(column: string, value: unknown): this {
    this.filters.push({ column, value, op: "eq" });
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push({ column, value, op: "neq" });
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push({ column, value: values, op: "in" });
    return this;
  }
  gt(column: string, value: unknown): this {
    this.filters.push({ column, value, op: "gt" });
    return this;
  }
  gte(column: string, value: unknown): this {
    this.filters.push({ column, value, op: "gte" });
    return this;
  }
  lt(column: string, value: unknown): this {
    this.filters.push({ column, value, op: "lt" });
    return this;
  }
  lte(column: string, value: unknown): this {
    this.filters.push({ column, value, op: "lte" });
    return this;
  }
  like(column: string, value: unknown): this {
    this.filters.push({ column, value, op: "like" });
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy.push({ column, ascending: opts?.ascending ?? true });
    return this;
  }
  limit(n: number): this {
    this.limitTo = n;
    return this;
  }
  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  /**
   * Supabase's `or()` takes a raw PostgREST filter string, e.g.
   * `"status.eq.active,status.eq.fulfilled"`. Only the simple
   * `column.op.value` form is supported, which is the only form this app uses.
   */
  or(filters: string): this {
    for (const clause of filters.split(",")) {
      const m = clause.trim().match(/^([a-z_]+)\.(eq|neq|gt|gte|lt|like)\.(.+)$/i);
      if (!m) continue;
      const [, column, op, raw] = m;
      this.filters.push({
        column,
        value: coerceValue(raw),
        op: op.toLowerCase() as Filter["op"],
      });
    }
    return this;
  }

  /**
   * Supabase's count/head query. A HEAD request returns only the count, so the
   * row payload is deliberately not materialised.
   */
  async count(): Promise<QueryResult<{ count: number }>> {
    this.headOnly = true;
    const rows = this.selected();
    return { data: { count: rows.length }, error: null };
  }

  private matches(row: Row): boolean {
    for (const f of this.filters) {
      const v = row[f.column];
      switch (f.op) {
        case "eq":
          if (Array.isArray(v) ? !v.includes(f.value) : v !== f.value) return false;
          break;
        case "neq":
          if (v === f.value) return false;
          break;
        case "in":
          if (!Array.isArray(f.value) || !f.value.includes(v)) return false;
          break;
        case "gt":
          if (!(Number(v) > Number(f.value))) return false;
          break;
        case "gte":
          if (!(Number(v) >= Number(f.value))) return false;
          break;
        case "lt":
          if (!(Number(v) < Number(f.value))) return false;
          break;
        case "lte":
          if (!(Number(v) <= Number(f.value))) return false;
          break;
        case "like":
          if (
            !String(v ?? "")
              .toLowerCase()
              .includes(String(f.value).toLowerCase())
          ) {
            return false;
          }
          break;
      }
    }
    return true;
  }

  private selected(): Row[] {
    const db = readDatabase();
    const table = (db as unknown as Record<string, Row[]>)[this.table] ?? [];
    let rows = table.filter((r) => this.matches(r));
    for (const o of [...this.orderBy].reverse()) {
      rows = [...rows].sort((a, b) => {
        const av = a[o.column];
        const bv = b[o.column];
        if (av === bv) return 0;
        const cmp =
          av === null || av === undefined
            ? -1
            : bv === null || bv === undefined
              ? 1
              : av < bv
                ? -1
                : 1;
        return o.ascending ? cmp : -cmp;
      });
    }
    if (this.rangeTo !== null) rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    if (this.limitTo !== null) rows = rows.slice(0, this.limitTo);
    return rows;
  }

  then(resolve: (result: any) => any): Promise<any> {
    return Promise.resolve(this.execute()).then(resolve);
  }

  async single(): Promise<QueryResult<Row>> {
    const r = this.execute();
    if (r.error) return r as unknown as QueryResult<Row>;
    if (!r.data || r.data.length === 0) {
      return fail<Row>("No rows found", "PGRST116");
    }
    return ok(r.data[0]);
  }

  async maybeSingle(): Promise<QueryResult<Row | null>> {
    const r = this.execute();
    if (r.error) return r as unknown as QueryResult<Row | null>;
    return ok(r.data?.[0] ?? null);
  }

  private execute(): QueryResult<Row[]> & { count?: number } {
    const result = this.run();
    if (this.wantsCount) {
      return { ...result, count: result.data?.length ?? 0 };
    }
    return result;
  }

  private run(): QueryResult<Row[]> {
    switch (this.mode) {
      case "select": {
        const rows = clone(this.selected());
        // A HEAD request asks for the count only, so no payload is returned.
        return this.headOnly ? { data: [] as Row[], error: null } : ok(rows);
      }

      case "insert":
      case "upsert": {
        const incoming = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
        return ok(updateDatabase((db) => {
          const store = db as unknown as Record<string, Row[]>;
          const out: Row[] = [];
          for (const row of incoming) {
            // Idempotent upsert: match on the primary key, never duplicate.
            const existing = row.id
              ? store[this.table].find((r) => r.id === row.id)
              : undefined;
            if (existing) {
              Object.assign(existing, row, { updated_at: nowIso() });
              out.push(existing);
            } else {
              const created = {
                ...row,
                id: row.id ?? newId(this.table.slice(0, 3)),
                created_at: row.created_at ?? nowIso(),
              };
              store[this.table].push(created);
              out.push(created);
            }
          }
          return clone(out);
        }));
      }

      case "update": {
        const patch = (this.payload ?? {}) as Row;
        return ok(updateDatabase((db) => {
          const store = db as unknown as Record<string, Row[]>;
          const updated: Row[] = [];
          for (const row of store[this.table]) {
            if (!this.matches(row)) continue;
            Object.assign(row, patch, { updated_at: nowIso() });
            updated.push(row);
          }
          return clone(updated);
        }));
      }

      case "delete": {
        return ok(updateDatabase((db) => {
          const store = db as unknown as Record<string, Row[]>;
          const removed: Row[] = [];
          store[this.table] = store[this.table].filter((row) => {
            const keep = !this.matches(row);
            if (keep) return true;
            removed.push(row);
            return false;
          });
          return clone(removed);
        }));
      }
    }
  }
}


/** Every RPC the app used to call in SQL, expressed against the local engine.
 *  Each re-reads authoritative state; none trusts a client-supplied role. */
const RPC = {
  /** The single "do the work" entry: expire what is due, then advance rings. */
  match_donors_for_request: () => ({ data: expandAlertRings(), error: null }),

  advance_alert_rings: () => ({ data: expandAlertRings(), error: null }),

  expire_stale_requests: () => ({ data: expandAlertRings(), error: null }),

  mark_alert_responded: (a: {
    p_alert_id: string;
    p_donor_id: string;
    p_response: string;
  }) => {
    const result = respondToAlert(
      a.p_alert_id,
      a.p_donor_id,
      a.p_response as "accepted" | "declined",
    );
    const failed = result !== "accepted" && result !== "declined";
    return {
      data: result,
      error: failed
        ? { message: RESPOND_MESSAGES[result] ?? "That alert can no longer be answered." }
        : null,
    };
  },

  reveal_accepted_donors: (a: { p_requester_id: string; p_request_ids: string[] }) => ({
    data: revealAcceptedDonors(a.p_requester_id, a.p_request_ids ?? []),
    error: null,
  }),

  set_request_status: (a: {
    p_request_id: string;
    p_requester_id: string;
    p_status: string;
  }) => {
    const result = setRequestStatus(
      a.p_request_id,
      a.p_requester_id,
      a.p_status as "fulfilled" | "cancelled",
    );
    return {
      data: result === "ok",
      error: result === "ok" ? null : { message: STATUS_MESSAGES[result] },
    };
  },

  close_request_process: (a: { p_request_id: string; p_outcome: string }) => {
    updateDatabase((db) => {
      const request = db.blood_requests.find((r) => r.id === a.p_request_id);
      if (request) {
        closeProcessForRequest(
          db,
          request,
          a.p_outcome as "accepted" | "request_closed" | "rings_exhausted",
        );
      }
    });
    return { data: null, error: null };
  },

  record_donation: (a: { p_donor_id: string; p_request_id: string; p_units: number }) => {
    const result = recordDonation(a.p_donor_id, a.p_request_id, a.p_units ?? 1);
    return { data: result.ok, error: result.ok ? null : { message: result.error } };
  },

  donor_recognition: () => {
    const user = currentUser();
    if (!user || user.role !== "donor") return { data: [], error: null };
    const history = readDatabase().donation_history.filter((h) => h.donor_id === user.id);
    const ladder = [1, 3, 5, 10, 25, 50];
    const dates = history.map((h) => h.donated_on).sort();
    return {
      data: [
        {
          total_donations: history.length,
          total_units: history.reduce((s, h) => s + (h.units ?? 1), 0),
          first_donation: dates[0] ?? null,
          last_donation: dates[dates.length - 1] ?? null,
          next_milestone: ladder.find((m) => m > history.length) ?? null,
          milestones: ladder.map((count) => ({
            count,
            reached: history.length >= count,
          })),
        },
      ],
      error: null,
    };
  },

  /** Advisory nudges were a database concern; the local dashboard shows the
   *  same information inline, so there is nothing to fire. */
  emit_donor_reminders: () => ({ data: 0, error: null }),

  requester_ring_status: (a: { p_request_id: string }) => {
    const db = readDatabase();
    const alerts = db.donor_alerts.filter((x) => x.request_id === a.p_request_id);
    const progress = db.ring_progress.find((p) => p.request_id === a.p_request_id);
    return {
      data: [
        {
          request_id: a.p_request_id,
          current_ring: (progress?.ring_index ?? -1) + 1,
          total_rings: RING_KM.length,
          total_alerts: alerts.length,
          outcome: progress?.outcome ?? null,
          finished_at: progress?.finished_at ?? null,
        },
      ],
      error: null,
    };
  },
} as const;

/** Plain-language reasons a response was rejected, matching the engine's
 *  result codes. The UI shows these; the codes never reach the user. */
const RESPOND_MESSAGES: Record<string, string> = {
  not_your_alert: "That alert belongs to another donor.",
  already_responded: "You have already responded to this alert.",
  request_closed: "This request is no longer active, so it can no longer be accepted.",
  already_taken: "Another donor accepted this request first.",
  not_eligible: "Your donor profile is not currently available for matching.",
};

/** Plain-language reasons a status change was rejected. */
const STATUS_MESSAGES: Record<string, string> = {
  not_found: "That request could not be found.",
  not_owner: "You can only change requests you created.",
  already_closed: "This request is already closed.",
};

/**
 * Creates the local client.
 *
 * Callers keep the existing `createClient()` / `createSupabaseServerClient()`
 * entry points, so nothing above this layer changes.
 */
export function createLocalClient(): LocalClient {
  return {
    from: (table: string) => new TableQuery(table),

    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      const fn = (
        RPC as unknown as Record<string, ((a: Record<string, unknown>) => unknown) | undefined>
      )[name];
      if (!fn) {
        return { data: null, error: { message: `Unknown function: ${name}` } };
      }
      return fn(args) as { data: any; error: { message: string } | null };
    },

    auth: {
      async getUser() {
        return { data: { user: currentUser() }, error: null };
      },
      async getSession() {
        const user = currentUser();
        return { data: { session: user ? { user } : null }, error: null };
      },

      async signInWithPassword({ email, password }) {
        const user = signIn(email, password);
        if (!user) {
          // Deliberately identical for "no such account" and "wrong password",
          // so this endpoint cannot be used to discover which emails exist.
          return {
            data: { user: null },
            error: { message: "Incorrect email or password." },
          };
        }
        if (user.status !== "active") {
          return {
            data: { user: null },
            error: { message: "This account has been suspended. Contact an administrator." },
          };
        }
        syncSessionCookie(user.id);
        return { data: { user }, error: null };
      },

      async signUp({ email, password, options }) {
        // The role comes from the submitted metadata but is RE-READ from the
        // server-validated profile row before anything privileged uses it, and
        // admin is never assignable here (see createUser in ./store).
        const user = createUser(email, password, (options?.data ?? {}) as {
          role?: string;
          full_name?: string;
        });
        syncSessionCookie(user.id);
        return { data: { user, session: { user } }, error: null };
      },

      async signOut() {
        writeSession(null);
        syncSessionCookie(null);
        return { error: null };
      },

      async resetPasswordForEmail() {
        // No mail transport exists in local mode, so this intentionally reports
        // success without revealing whether the address is registered.
        return { error: null };
      },

      async updateUser() {
        return { error: null };
      },

      async verifyOtp() {
        return {
          error: {
            message:
              "Password reset links are not sent in this local build. Set a new password from your account page instead.",
          },
        };
      },
    },

    // Realtime shim. Local mode has no server to push from, and the pages that
    // subscribed to Supabase realtime already refresh on window focus and on an
    // interval, so this only needs to be a valid no-op.
    channel(): LocalChannel {
      const channel: LocalChannel = {
        on: () => channel,
        subscribe: () => channel,
        unsubscribe: () => {},
      };
      return channel;
    },

    async removeChannel() {
      // Nothing to unsubscribe from.
    },
  };
}


/** The public client shape. Mirrors the slice of the Supabase API the app uses,
 *  so components and server actions need no changes. */
export interface LocalClient {
  from(table: string): TableQuery;
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: any; error: { message: string; code?: string } | null }>;
  auth: {
    getUser(): Promise<{ data: { user: LocalUser | null }; error: null }>;
    getSession(): Promise<{
      data: { session: { user: LocalUser } | null };
      error: null;
    }>;
    signInWithPassword(credentials: {
      email: string;
      password: string;
    }): Promise<{ data: { user: LocalUser | null }; error: { message: string } | null }>;
    signUp(credentials: {
      email: string;
      password: string;
      options?: { data?: Record<string, unknown>; emailRedirectTo?: string };
    }): Promise<{
      data: { user: LocalUser | null; session: unknown };
      error: { message: string } | null;
    }>;
    signOut(): Promise<{ error: null }>;
    resetPasswordForEmail(
      email: string,
      options?: { redirectTo?: string },
    ): Promise<{ error: null }>;
    updateUser(attributes: { password?: string }): Promise<{ error: null }>;
    verifyOtp(_params: unknown): Promise<{ error: { message: string } }>;
  };
  /** Realtime shim — see LocalChannel. */
  channel(name: string): LocalChannel;
  removeChannel(channel: LocalChannel): Promise<void>;
}

/**
 * Realtime stand-in.
 *
 * There is no server to push events from, so subscribing is a no-op that keeps
 * the call chain valid. Callers already refresh on window focus and on an
 * interval, so nothing depends on this firing.
 */
export interface LocalChannel {
  on(
    _type: string,
    _filter: Record<string, unknown>,
    _callback: (payload: unknown) => void,
  ): LocalChannel;
  subscribe(): LocalChannel;
  unsubscribe(): void;
}
