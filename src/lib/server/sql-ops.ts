/**
 * The server `rpc` functions that used to fall through to the browser
 * (localStorage) adapter. On the server that store is always empty, so the
 * admin overview, admin alerts, drive stats, both volunteer views and every
 * verification step silently read nothing and saved nothing. These run the
 * same functions against SQL (local SQLite or Turso).
 *
 * Every function takes the caller from the session, never from the arguments.
 * Spec: supabase/migrations/0019 for verifications, the former local
 * projections for the read views.
 */
import { randomUUID } from "node:crypto";

import { getDriver } from "./driver";
import { ALERT_RINGS_KM } from "@/lib/constants";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null };

export interface OpsCaller {
  id: string;
  role: string;
}

const ok = (data: unknown): Result => ({ data, error: null });
const isAdmin = (c: OpsCaller) => c.role === "admin";
const isVolunteer = (c: OpsCaller) => c.role === "volunteer" || isAdmin(c);
const limitOf = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
const ringKm = (index: unknown) =>
  ALERT_RINGS_KM[Math.min(Math.max(Number(index) || 1, 1), ALERT_RINGS_KM.length) - 1] ?? null;
/** Verification window, matching the SQL default (p_target_minutes = 15). */
const VERIFICATION_MINUTES = 15;

/* -------------------------------------------------------------- volunteer */

const VOLUNTEER_REQUEST_SQL = `SELECT r.id, r.blood_group, r.blood_component, r.units, r.locality,
         r.urgency, r.required_by, r.status, r.note, r.created_at,
         EXISTS (SELECT 1 FROM donor_alerts a WHERE a.request_id = r.id AND a.response = 'accepted')
           AS donor_accepted,
         (SELECT COUNT(*) FROM request_assistance s WHERE s.request_id = r.id AND s.status = 'assisting')
           AS volunteers_assisting,
         EXISTS (SELECT 1 FROM request_assistance s
                  WHERE s.request_id = r.id AND s.volunteer_id = ? AND s.status = 'assisting')
           AS me_assisting
    FROM blood_requests r`;

const volunteerRow = (r: Row) => ({
  ...r,
  donor_accepted: Boolean(r.donor_accepted),
  volunteers_assisting: Number(r.volunteers_assisting),
  me_assisting: Boolean(r.me_assisting),
});

async function volunteerActiveRequests(args: Row, caller: OpsCaller): Promise<Result> {
  if (!isVolunteer(caller)) return ok([]);
  const rows = (await (await getDriver()).query(
    `${VOLUNTEER_REQUEST_SQL} WHERE r.status = 'active' ORDER BY r.required_by ASC LIMIT ?`,
    [caller.id, limitOf(args.p_limit, 50)],
  )) as Row[];
  return ok(rows.map(volunteerRow));
}

async function volunteerRequestDetail(args: Row, caller: OpsCaller): Promise<Result> {
  if (!isVolunteer(caller)) return ok([]);
  const rows = (await (await getDriver()).query(`${VOLUNTEER_REQUEST_SQL} WHERE r.id = ?`, [
    caller.id,
    String(args.p_request_id ?? ""),
  ])) as Row[];
  return ok(rows.map(volunteerRow));
}

/* ----------------------------------------------------------- verification */

async function isActiveVolunteer(userId: string): Promise<boolean> {
  return Boolean(
    await (await getDriver()).queryOne(
      `SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id = u.id
        WHERE u.id = ? AND u.status = 'active' AND ur.role = 'volunteer'`,
      [userId],
    ),
  );
}

async function startVolunteerVerification(args: Row, caller: OpsCaller): Promise<Result> {
  if (!(await isActiveVolunteer(caller.id))) return ok("volunteer_inactive");
  const requestId = String(args.p_request_id ?? "");
  const db = await getDriver();
  return db.transaction(async (t) => {
    const request = (await t.queryOne("SELECT status FROM blood_requests WHERE id = ?", [requestId])) as
      | Row
      | undefined;
    if (!request || request.status !== "active") return ok("not_found");
    const existing = (await t.queryOne(
      `SELECT status FROM volunteer_verifications
        WHERE request_id = ? AND status IN ('pending','verified') ORDER BY status = 'verified' DESC LIMIT 1`,
      [requestId],
    )) as Row | undefined;
    if (existing) return ok(existing.status === "verified" ? "already_verified" : "already_pending");
    const now = new Date();
    const iso = now.toISOString();
    const deadline = new Date(now.getTime() + VERIFICATION_MINUTES * 60_000).toISOString();
    await t.run(
      `INSERT INTO volunteer_verifications
         (id, request_id, volunteer_id, status, target_deadline, started_at, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [randomUUID(), requestId, caller.id, deadline, iso, iso, iso],
    );
    return ok("success");
  });
}

async function completeVolunteerVerification(args: Row, caller: OpsCaller): Promise<Result> {
  const outcome = String(args.p_outcome ?? "");
  if (outcome !== "verified" && outcome !== "rejected") return ok("invalid_outcome");
  const requestId = String(args.p_request_id ?? "");
  const db = await getDriver();
  return db.transaction(async (t) => {
    const task = (await t.queryOne(
      `SELECT vv.id, vv.volunteer_id, r.status AS request_status
         FROM volunteer_verifications vv JOIN blood_requests r ON r.id = vv.request_id
        WHERE vv.request_id = ? AND vv.status = 'pending'`,
      [requestId],
    )) as Row | undefined;
    if (!task) return ok("not_pending");
    if (task.volunteer_id !== caller.id) return ok("not_your_task");
    if (task.request_status !== "active") return ok("requester_closed");
    const now = new Date().toISOString();
    await t.run(
      `UPDATE volunteer_verifications
          SET status = ?, completed_at = ?, verified_by = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'`,
      [outcome, now, caller.id, now, String(task.id)],
    );
    return ok(`success_${outcome}`);
  });
}

async function escalateVolunteerVerification(args: Row, caller: OpsCaller): Promise<Result> {
  const target = String(args.p_target_volunteer_id ?? "");
  if (target === caller.id) return ok("self_target");
  if (!(await isActiveVolunteer(target))) return ok("invalid_target");
  const requestId = String(args.p_request_id ?? "");
  const db = await getDriver();
  return db.transaction(async (t) => {
    const task = (await t.queryOne(
      "SELECT id, volunteer_id, target_deadline FROM volunteer_verifications WHERE request_id = ? AND status = 'pending'",
      [requestId],
    )) as Row | undefined;
    if (!task) return ok("not_pending");
    if (task.volunteer_id !== caller.id) return ok("not_your_task");
    const now = new Date().toISOString();
    // Close the old task first: the one-pending-per-request index forbids two at once.
    await t.run(
      "UPDATE volunteer_verifications SET status = 'escalated', escalated_to = ?, updated_at = ? WHERE id = ?",
      [target, now, String(task.id)],
    );
    await t.run(
      `INSERT INTO volunteer_verifications
         (id, request_id, volunteer_id, status, target_deadline, started_at, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [randomUUID(), requestId, target, String(task.target_deadline), now, now, now],
    );
    return ok("success");
  });
}

async function myPendingVerifications(caller: OpsCaller): Promise<Result> {
  if (!(await isActiveVolunteer(caller.id))) return ok([]);
  const rows = (await (await getDriver()).query(
    `SELECT vv.id, vv.request_id, r.blood_group, r.blood_component, r.units,
            r.locality AS hospital_locality, r.urgency, r.required_by,
            vv.target_deadline, vv.started_at, vv.status
       FROM volunteer_verifications vv JOIN blood_requests r ON r.id = vv.request_id
      WHERE vv.volunteer_id = ? AND vv.status = 'pending' AND r.status = 'active'
      ORDER BY vv.target_deadline ASC`,
    [caller.id],
  )) as Row[];
  const now = Date.now();
  return ok(
    rows.map((r) => ({
      ...r,
      hospital_name: "",
      minutes_left: Math.max(0, Math.floor((Date.parse(String(r.target_deadline)) - now) / 60_000)),
    })),
  );
}

/* ------------------------------------------------------------------ admin */

async function adminListAlerts(args: Row, caller: OpsCaller): Promise<Result> {
  if (!isAdmin(caller)) return ok([]);
  const rows = (await (await getDriver()).query(
    `SELECT a.id AS alert_id, a.request_id, a.donor_id, a.ring_km, a.status, a.response,
            a.due_at, a.created_at, a.responded_at,
            CASE WHEN a.response = 'accepted' THEN a.responded_at END AS accepted_at,
            COALESCE(r.blood_group, '') AS blood_group, COALESCE(r.locality, '') AS locality
       FROM donor_alerts a LEFT JOIN blood_requests r ON r.id = a.request_id
      ORDER BY a.created_at DESC LIMIT ?`,
    [limitOf(args.p_limit, 100)],
  )) as Row[];
  return ok(rows);
}

async function adminRingProgress(args: Row, caller: OpsCaller): Promise<Result> {
  if (!isAdmin(caller)) return ok([]);
  const rows = (await (await getDriver()).query(
    `SELECT p.request_id, p.ring_index, p.started_at, p.finished_at, p.outcome,
            (SELECT COUNT(*) FROM donor_alerts a
              WHERE a.request_id = p.request_id AND a.ring_index = p.ring_index) AS alerts_sent,
            COALESCE(r.status, '') AS request_status, COALESCE(r.blood_group, '') AS blood_group,
            COALESCE(r.locality, '') AS locality, COALESCE(r.required_by, '') AS required_by
       FROM ring_progress p LEFT JOIN blood_requests r ON r.id = p.request_id
      ORDER BY p.started_at DESC LIMIT ?`,
    [limitOf(args.p_limit, 50)],
  )) as Row[];
  return ok(rows.map((r) => ({ ...r, ring_km: ringKm(r.ring_index), alerts_sent: Number(r.alerts_sent) })));
}

/** Every number is counted from stored records; a fresh install reports zeroes. */
async function adminPlatformOverview(caller: OpsCaller): Promise<Result> {
  if (!isAdmin(caller)) return ok([]);
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const row = (await (await getDriver()).queryOne(
    `SELECT
       (SELECT COUNT(*) FROM users) AS total_users,
       (SELECT COUNT(*) FROM user_roles WHERE role = 'donor') AS total_donors,
       (SELECT COUNT(*) FROM user_roles WHERE role = 'requester') AS total_requesters,
       (SELECT COUNT(*) FROM user_roles WHERE role = 'volunteer') AS total_volunteers,
       (SELECT COUNT(*) FROM user_roles WHERE role = 'admin') AS total_admins,
       (SELECT COUNT(*) FROM users WHERE status = 'suspended') AS suspended_users,
       (SELECT COUNT(*) FROM blood_requests WHERE status = 'active') AS active_requests,
       (SELECT COUNT(*) FROM blood_requests WHERE status = 'fulfilled') AS fulfilled_requests,
       (SELECT COUNT(*) FROM blood_requests WHERE status = 'expired') AS expired_requests,
       (SELECT COUNT(*) FROM blood_requests WHERE status = 'cancelled') AS cancelled_requests,
       (SELECT COUNT(*) FROM donations) AS completed_donations,
       (SELECT COUNT(*) FROM request_reports WHERE status = 'open') AS open_reports,
       (SELECT COUNT(*) FROM request_reports WHERE status = 'under_review') AS under_review_reports,
       (SELECT COUNT(*) FROM request_reports WHERE status IN ('resolved','dismissed')) AS resolved_reports,
       (SELECT COUNT(*) FROM request_reports WHERE created_at >= ?) AS reports_last_24h,
       (SELECT COUNT(*) FROM donor_alerts WHERE status IN ('sent','opened')) AS active_alerts,
       (SELECT COUNT(*) FROM donor_alerts WHERE response = 'accepted') AS accepted_alerts,
       (SELECT COUNT(*) FROM donor_profiles WHERE availability = 'available') AS available_donors`,
    [dayAgo],
  )) as Row;
  return ok([Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)]))]);
}

async function campusDriveStats(args: Row, caller: OpsCaller): Promise<Result> {
  if (!isAdmin(caller)) return ok([]);
  const id = String(args.p_drive_id ?? "");
  const db = await getDriver();
  const drive = (await db.queryOne("SELECT target_units FROM campus_blood_drives WHERE id = ?", [id])) as
    | Row
    | undefined;
  if (!drive) return ok([]);
  const counts = (await db.queryOne(
    `SELECT SUM(status = 'registered') AS registered,
            SUM(status = 'checked_in') AS checked_in,
            SUM(status = 'participated') AS participated,
            SUM(status = 'cancelled') AS cancelled,
            (SELECT COALESCE(SUM(units), 0) FROM donations WHERE drive_id = ?) AS units_collected
       FROM campus_drive_registrations WHERE drive_id = ?`,
    [id, id],
  )) as Row;
  // A tally by blood group, never a roster of who is in which group.
  const groups = (await db.query(
    `SELECT p.blood_group, COUNT(*) AS n
       FROM campus_drive_registrations g JOIN donor_profiles p ON p.user_id = g.donor_id
      WHERE g.drive_id = ? AND p.blood_group IS NOT NULL GROUP BY p.blood_group`,
    [id],
  )) as Row[];
  return ok([
    {
      registered: Number(counts.registered ?? 0),
      checked_in: Number(counts.checked_in ?? 0),
      participated: Number(counts.participated ?? 0),
      cancelled: Number(counts.cancelled ?? 0),
      units_collected: Number(counts.units_collected),
      target_units: drive.target_units == null ? null : Number(drive.target_units),
      group_breakdown: groups.length
        ? Object.fromEntries(groups.map((g) => [String(g.blood_group), Number(g.n)]))
        : null,
    },
  ]);
}

/**
 * Dispatch. Returns null for a name this module does not own, so the caller
 * can report it as unknown instead of resolving to a silent empty result.
 */
export async function runServerOpsRpc(name: string, args: Row, caller: OpsCaller): Promise<Result | null> {
  switch (name) {
    case "volunteer_active_requests":
      return volunteerActiveRequests(args, caller);
    case "volunteer_request_detail":
      return volunteerRequestDetail(args, caller);
    case "start_volunteer_verification":
      return startVolunteerVerification(args, caller);
    case "complete_volunteer_verification":
      return completeVolunteerVerification(args, caller);
    case "escalate_volunteer_verification":
      return escalateVolunteerVerification(args, caller);
    case "my_pending_verifications":
      return myPendingVerifications(caller);
    case "admin_list_alerts":
      return adminListAlerts(args, caller);
    case "admin_ring_progress":
      return adminRingProgress(args, caller);
    case "admin_platform_overview":
      return adminPlatformOverview(caller);
    case "campus_drive_stats":
      return campusDriveStats(args, caller);
    // Reminders were advisory no-ops in every build so far: no scheduler or
    // mail transport exists. Kept as no-ops so the pages that tick them never break.
    case "emit_alert_expiring":
    case "emit_donor_reminders":
    case "emit_drive_reminders":
      return ok(0);
    default:
      return null;
  }
}
