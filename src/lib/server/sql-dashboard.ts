/**
 * Server-side execution of the dashboard read contract.
 *
 * Two guarantees make this the safe place to translate a browser spec into
 * SQL — neither lives in the browser, because neither can be trusted there:
 *
 *  1. IDENTITY. The caller is passed in from the HTTP-only session cookie by
 *     the server action, never from the request payload. Every owner-scoped
 *     table gets a MANDATORY `eq(ownerColumn, caller.id)` ANDed in even when
 *     the client already supplied one, so a spec naming somebody else's row
 *     can only ever resolve to empty — it cannot widen.
 *
 *  2. IDENTIFIERS. Tables come from a fixed allow-list and every value is
 *     bound as a parameter by `sql-adapter`, the same adapter `check-sqlite`
 *     exercises.
 *
 * The five projections below used to be `SECURITY DEFINER` Postgres functions
 * (migrations 0011/0012/0015/0016). They are re-expressed here against SQLite
 * with the same return shapes — the TypeScript interfaces in `@/types` are the
 * contract, and the UI consumes those shapes unchanged.
 *
 * SERVER ONLY: opens the database file on disk.
 */

import { getDb } from "./db";
import { createSqlClient, type QueryResult, type SqlTableQuery } from "./sql-adapter";
import type { DashboardQueryResult, TableQuerySpec } from "@/lib/dashboard-query";
import { ALERT_RINGS_KM } from "@/lib/constants";
import { haversineKm } from "@/lib/geo";

/** The signed-in account, as the server resolved it from the session cookie. */
export interface DashboardCaller {
  id: string;
  role: string;
}

type Row = Record<string, unknown>;

/**
 * Build a success result.
 *
 * Every row is re-rooted on `Object.prototype` here — ONE boundary, for all
 * five projections. `node:sqlite` returns rows with a NULL prototype, and
 * React's flight serializer refuses those on the action wire ("Classes or
 * null prototypes are not supported"): a projection returning raw `.all()`
 * rows looks fine in every function-level test yet dies in the browser the
 * moment it has actual data. A spread at this single choke point makes that
 * impossible to reintroduce per-projection.
 */
const ok = (data: unknown, count?: number | null): QueryResult => ({
  data: Array.isArray(data)
    ? data.map((row) =>
      row && typeof row === "object" && !Array.isArray(row) ? { ...row } : row,
    )
    : data,
  error: null,
  ...(count === undefined ? {} : { count }),
});
const fail = (message: string, code?: string): QueryResult => ({
  data: null,
  error: { message, code },
});

/* ------------------------------------------------------------------ tables */

/**
 * The only tables this seam will read, with the column that makes a row
 * somebody's OWN. A table listed here without an owner column is public
 * content, not an oversight.
 */
const OWNER_COLUMN: Record<string, string> = {
  blood_requests: "requester_id",
  donor_profiles: "user_id",
  donor_alerts: "donor_id",
  donations: "donor_id",
  campus_drive_registrations: "donor_id",
};
/** Published drives are readable by any signed-in user; drafts are not. */
const PUBLIC_TABLES = new Set(["campus_blood_drives"]);

/** Replay one collected filter. An unknown operator is refused, never dropped. */
function applyFilter(
  q: SqlTableQuery,
  filter: TableQuerySpec["filters"][number],
): SqlTableQuery | null {
  const { column, op, value } = filter;
  switch (op) {
    case "eq": return q.eq(column, value);
    case "neq": return q.neq(column, value);
    case "in": return q.in(column, Array.isArray(value) ? value : []);
    case "gt": return q.gt(column, value);
    case "gte": return q.gte(column, value);
    case "lt": return q.lt(column, value);
    case "lte": return q.lte(column, value);
    case "like": return q.like(column, value);
    default: return null;
  }
}

/**
 * Execute one collected read.
 *
 * The result is whatever `sql-adapter` returns, so a page sees the identical
 * `{ data, error, count }` it saw before — empty only when the database
 * genuinely holds no matching rows.
 */
export async function runDashboardTableQuery(
  spec: TableQuerySpec,
  caller: DashboardCaller,
): Promise<QueryResult> {
  const ownerColumn = OWNER_COLUMN[spec.table];
  if (!ownerColumn && !PUBLIC_TABLES.has(spec.table)) {
    return fail(`Table "${spec.table}" is not readable from the dashboard.`, "42P01");
  }

  let q: SqlTableQuery = createSqlClient()
    .from(spec.table)
    .select(
      spec.columns ?? undefined,
      spec.count || spec.head ? { count: "exact", head: spec.head } : undefined,
    );

  for (const filter of spec.filters) {
    const applied = applyFilter(q, filter);
    if (!applied) return fail(`Unsupported filter "${String(filter.op)}".`, "42601");
    q = applied;
  }
  for (const group of spec.orGroups) q = q.or(group);

  // THE scope. Appended unconditionally, so a client-supplied owner id can
  // only ever narrow to the caller's own rows — never to somebody else's.
  if (ownerColumn) q = q.eq(ownerColumn, caller.id);
  if (spec.table === "campus_blood_drives" && caller.role !== "admin") {
    q = q.eq("published", true);
  }

  for (const order of spec.orders) q = q.order(order.column, { ascending: order.ascending });

  if (spec.limit !== null) {
    q = spec.offset > 0 ? q.range(spec.offset, spec.offset + spec.limit - 1) : q.limit(spec.limit);
  }

  return await q;
}

/* -------------------------------------------------------------------- rpcs */

/** The fixed, transparent recognition ladder (migration 0016). */
const LADDER = [1, 3, 5, 10, 25, 50];

/** Mirrors the SQL `least(greatest(coalesce(p_limit, …), 1), 200)` clamp. */
const limitOf = (value: unknown, fallback: number): number => {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, 1), 200);
};

/**
 * `p_request_ids` from the caller, tolerating the singular spelling too.
 *
 * The local adapter read `p_request_id` (singular) while the pages send
 * `p_request_ids` (plural), so every ring-status read keyed on `undefined`.
 * Both spellings are accepted here, and an empty list resolves to an empty
 * result rather than to a scan of nothing.
 */
function requestIdList(args: Record<string, unknown>): string[] {
  const raw = args.p_request_ids ?? args.p_request_id;
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  const ids = [...new Set(list.filter((id): id is string => typeof id === "string" && id !== ""))];
  return ids.slice(0, 500);
}

const placeholders = (count: number): string => new Array(count).fill("?").join(",");

/** The caller's own alert queue, joined to the request (migration 0012). */
function donorActiveAlerts(args: Record<string, unknown>, caller: DashboardCaller): QueryResult {
  if (caller.role !== "donor") return ok([]);
  const now = new Date().toISOString();
  const limit = limitOf(args.p_limit, 20);

  const profile = getDb()
    .prepare("SELECT latitude, longitude FROM donor_profiles WHERE user_id = ?")
    .get(caller.id) as { latitude: number | null; longitude: number | null } | undefined;

  const rows = getDb()
    .prepare(
      `SELECT a.id AS alert_id,
              a.request_id,
              a.ring_km,
              a.status,
              a.response,
              a.due_at,
              a.created_at,
              a.responded_at,
              -- SQLite keeps ONE response window on the alert (due_at): the
              -- same min(response-due, request-deadline) the local engine
              -- recorded as contact_shared_until. It is both the deadline the
              -- UI counts down and the gate on revealing requester contact.
              a.due_at AS contact_shared_until,
              r.blood_group,
              r.blood_component,
              r.units,
              r.locality,
              r.locality,
              r.urgency,
              r.required_by,
              r.note,
              r.status AS request_status,
              r.latitude AS request_latitude,
              r.longitude AS request_longitude,
              CASE WHEN a.response = 'accepted' AND a.due_at > ?
                   THEN r.requester_name END AS requester_contact_name,
              CASE WHEN a.response = 'accepted' AND a.due_at > ?
                   THEN r.requester_phone END AS requester_contact_phone
         FROM donor_alerts a
         JOIN blood_requests r ON r.id = a.request_id
        WHERE a.donor_id = ?
        ORDER BY a.created_at DESC
        LIMIT ?`,
    )
    .all(now, now, caller.id, limit) as Row[];

  return ok(
    rows.map((row) => {
      const distance = haversineKm(
        profile?.latitude,
        profile?.longitude,
        row.request_latitude as number | null,
        row.request_longitude as number | null,
      );
      const { request_latitude: _lat, request_longitude: _lng, ...rest } = row;
      return {
        ...rest,
        // Whole kilometres only; the coordinates themselves never leave here.
        approx_distance_km: distance === null ? null : Math.round(distance),
      };
    }),
  );
}

/** The caller's own recorded donations (migration 0015, drive-aware). */
function donorDonationHistory(args: Record<string, unknown>, caller: DashboardCaller): QueryResult {
  if (caller.role !== "donor") return ok([]);
  const rows = getDb()
    .prepare(
      `SELECT h.donated_on AS donation_date,
              h.units,
              COALESCE(h.blood_component, r.blood_component) AS blood_component,
              r.locality,
              r.locality,
              r.status AS request_status,
              h.request_id,
              h.drive_id,
              d.title AS drive_title
         FROM donations h
         LEFT JOIN blood_requests r ON r.id = h.request_id
         LEFT JOIN campus_blood_drives d ON d.id = h.drive_id
        WHERE h.donor_id = ?
        ORDER BY h.donated_on DESC, h.created_at DESC
        LIMIT ?`,
    )
    .all(caller.id, limitOf(args.p_limit, 20)) as Row[];
  return ok(rows);
}

/**
 * The caller's own recognition (migration 0016).
 *
 * Counted from DONATIONS ONLY — never alerts, never acceptances — because a
 * donor is recognised for blood actually given. Donor role checked here, own
 * rows only, and no private field is part of the returned shape.
 */
function donorRecognition(caller: DashboardCaller): QueryResult {
  if (caller.role !== "donor") return ok([]);
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS total_donations,
              COALESCE(SUM(units), 0) AS total_units,
              MIN(donated_on) AS first_donation,
              MAX(donated_on) AS last_donation
         FROM donations
        WHERE donor_id = ?`,
    )
    .get(caller.id) as Row;
  const total = Number(row.total_donations ?? 0);
  return ok([
    {
      total_donations: total,
      total_units: Number(row.total_units ?? 0),
      first_donation: row.first_donation ?? null,
      last_donation: row.last_donation ?? null,
      next_milestone: LADDER.find((step) => step > total) ?? null,
      milestones: LADDER.map((count) => ({ count, reached: total >= count })),
    },
  ]);
}

/**
 * The ONLY path that reveals a donor's contact to another person
 * (migration 0011): requester-only, post-acceptance, time-boxed.
 *
 * Ownership is re-checked inside the body (`r.requester_id = caller.id`), so
 * a crafted request-id list can never reach a request somebody else created.
 * One row per request — the newest acceptance wins, matching Postgres'
 * `distinct on (r.id) … order by a.accepted_at desc`.
 */
function revealAcceptedDonors(args: Record<string, unknown>, caller: DashboardCaller): QueryResult {
  const ids = requestIdList(args);
  if (ids.length === 0) return ok([]);
  const now = new Date().toISOString();
  const rows = getDb()
    .prepare(
      `SELECT r.id AS request_id,
              u.full_name AS donor_name,
              dp.phone AS donor_phone,
              dp.blood_group AS donor_blood_group,
              dp.locality AS donor_locality
         FROM donor_alerts a
         JOIN blood_requests r ON r.id = a.request_id
         JOIN donor_profiles dp ON dp.user_id = a.donor_id
         JOIN users u ON u.id = a.donor_id
        WHERE r.requester_id = ?
          AND a.response = 'accepted'
          AND a.due_at > ?
          AND r.id IN (${placeholders(ids.length)})
          AND a.id = (SELECT MAX(a2.id)
                        FROM donor_alerts a2
                       WHERE a2.request_id = a.request_id
                         AND a2.response = 'accepted')
        ORDER BY r.id`,
    )
    .all(caller.id, now, ...ids) as Row[];
  return ok(rows);
}

/**
 * Ring-engine progress for the caller's OWN requests (migration 0011).
 *
 * `alerts_sent` is derived: SQLite keeps ONE `ring_progress` row per request
 * (the current ring), so the count is every alert raised for that request —
 * the figure the dashboard then sums into "N donors were alerted in total".
 * A per-ring count would make that public total understate how many people
 * were actually contacted.
 *
 * `ring_km` is derived from the ring index because SQLite's ring row does not
 * carry it; indices are 1-based (`check (ring_index >= 1)` in migration 0011).
 */
function requesterRingStatus(args: Record<string, unknown>, caller: DashboardCaller): QueryResult {
  const ids = requestIdList(args);
  if (ids.length === 0) return ok([]);
  const rows = getDb()
    .prepare(
      `SELECT rp.request_id,
              rp.ring_index,
              rp.started_at,
              rp.finished_at,
              rp.outcome,
              (SELECT COUNT(*) FROM donor_alerts a WHERE a.request_id = rp.request_id)
                AS alerts_sent
         FROM ring_progress rp
         JOIN blood_requests br ON br.id = rp.request_id
        WHERE rp.request_id IN (${placeholders(ids.length)})
          AND br.requester_id = ?
        ORDER BY rp.ring_index DESC`,
    )
    .all(...ids, caller.id) as Row[];

  const highest = ALERT_RINGS_KM.length;
  return ok(
    rows.map((row) => {
      const index = Number(row.ring_index) || 1;
      const clamped = Math.min(Math.max(index, 1), highest);
      return { ...row, ring_km: ALERT_RINGS_KM[clamped - 1] ?? null };
    }),
  );
}

/**
 * The browser-facing `rpc` surface: a short allow-list, each projection
 * scoped to the session's own user. Anything else is reported as an unknown
 * function rather than resolving to a silent empty result — the failure mode
 * that once rendered whole pages blank behind a green build.
 */
export async function runDashboardRpc(
  name: string,
  args: Record<string, unknown>,
  caller: DashboardCaller,
): Promise<DashboardQueryResult> {
  try {
    switch (name) {
      case "donor_active_alerts":
        return donorActiveAlerts(args, caller);
      case "donor_donation_history":
        return donorDonationHistory(args, caller);
      case "donor_recognition":
        return donorRecognition(caller);
      case "reveal_accepted_donors":
        return revealAcceptedDonors(args, caller);
      case "requester_ring_status":
        return requesterRingStatus(args, caller);
      default:
        return fail(`Unknown function: ${name}`, "42883");
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : "database error", "DBERR");
  }
}



