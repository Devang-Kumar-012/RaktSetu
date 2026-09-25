/**
 * Read-only projections the UI expects from the historical database functions.
 *
 * WHY A SEPARATE MODULE
 *
 * The application calls a family of `rpc(...)` functions that used to be
 * SECURITY DEFINER functions in Postgres: donor alert lists, volunteer views,
 * admin overviews, campus-drive statistics, matching summaries. The adapter
 * implements the WRITE side (accept, fulfil, cancel, record a donation), but
 * these read-side functions were never implemented — so every donor alert list,
 * volunteer dashboard, admin overview and drive-statistics panel silently
 * rendered as empty while the build stayed green.
 *
 * Every projection receives the CALLER explicitly (the adapter owns the
 * session) rather than reaching for it, which keeps this module free of a
 * circular import and makes each function directly testable.
 *
 * Each function scopes itself to that caller, and the admin-only projections
 * refuse outright for anyone who is not an admin. This is prototype-grade
 * privacy, not a substitute for database RLS.
 */

import { distanceKm } from "./engine";
import {
  readDatabase,
  type LocalBloodRequest,
  type LocalDonorAlert,
} from "./store";

/** The signed-in account, as the adapter sees it. */
export interface Caller {
  id: string;
  role: string;
  status: string;
}

export type RpcResult<T> =
  | { data: T; error: null }
  | { data: null; error: { message: string } };

const isAdmin = (who: Caller | null): boolean => who?.role === "admin";

/** Whole-km distance, rounded for display. Null when either point is unknown. */
function approxKm(
  a: LocalBloodRequest,
  b: { latitude: number | null; longitude: number | null },
): number | null {
  const d = distanceKm(a.latitude, a.longitude, b.latitude, b.longitude);
  return d === null ? null : Math.round(d);
}

const limitOf = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;

/* ------------------------------------------------------------------ donor */

/** Alerts belonging to the signed-in donor, joined to their requests. */
export function donorActiveAlerts(
  args: Record<string, unknown>,
  who: Caller | null,
): RpcResult<unknown[]> {
  if (!who || who.role !== "donor") return { data: [], error: null };
  const db = readDatabase();
  const limit = limitOf(args.p_limit, 20);
  const prof = db.donor_profiles.find((p) => p.user_id === who.id);
  const rows = db.donor_alerts
    .filter((a) => a.donor_id === who.id && a.status !== "expired")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, limit)
    .map((a: LocalDonorAlert) => {
      const r = db.blood_requests.find((x) => x.id === a.request_id);
      if (!r) return null;
      return {
        alert_id: a.id,
        request_id: a.request_id,
        ring_km: a.ring_km,
        // Approximate distance only; exact coordinates are never returned.
        approx_distance_km: prof ? approxKm(r, prof) : null,
        status: a.status,
        response: a.response,
        // The response window ends at the request's own deadline offset, which
        // the engine already computed onto the alert as contact_shared_until.
        due_at: a.contact_shared_until ?? r.required_by,
        created_at: a.created_at,
        responded_at: a.responded_at,
        contact_shared_until: a.contact_shared_until,
        blood_group: r.blood_group,
        blood_component: r.blood_component,
        units: r.units,
        hospital_name: r.hospital_name,
        hospital_locality: r.hospital_locality,
        urgency: r.urgency,
        required_by: r.required_by,
        note: r.note,
        request_status: r.status,
        // The requester's own contact reaches the donor only after acceptance.
        requester_contact_name: a.response === "accepted" ? r.requester_name : null,
        requester_contact_phone: a.response === "accepted" ? r.requester_phone : null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  return { data: rows, error: null };
}

/** The donor's own recorded donations, newest first, joined to context. */
export function donorDonationHistory(
  args: Record<string, unknown>,
  who: Caller | null,
): RpcResult<unknown[]> {
  if (!who || who.role !== "donor") return { data: [], error: null };
  const db = readDatabase();
  const limit = limitOf(args.p_limit, 20);
  const rows = db.donation_history
    .filter((h) => h.donor_id === who.id)
    .sort((a, b) => (a.donated_on < b.donated_on ? 1 : -1))
    .slice(0, limit)
    .map((h) => {
      const r = h.request_id
        ? db.blood_requests.find((x) => x.id === h.request_id)
        : null;
      const drive = h.drive_id
        ? db.campus_blood_drives.find((d) => d.id === h.drive_id)
        : null;
      return {
        donation_date: h.donated_on,
        units: h.units,
        blood_component: h.blood_component,
        hospital_name: r?.hospital_name ?? null,
        hospital_locality: r?.hospital_locality ?? null,
        request_status: r?.status ?? null,
        request_id: h.request_id,
        drive_id: h.drive_id,
        drive_title: drive?.title ?? null,
      };
    });
  return { data: rows, error: null };
}

/* -------------------------------------------------------------- volunteer */

/**
 * Requests a volunteer may coordinate. Deliberately excludes donor contact
 * details: a volunteer assists, they do not receive donors' private data.
 */
export function volunteerActiveRequests(
  args: Record<string, unknown>,
  who: Caller | null,
): RpcResult<unknown[]> {
  if (!who || (who.role !== "volunteer" && !isAdmin(who))) {
    return { data: [], error: null };
  }
  const db = readDatabase();
  const limit = limitOf(args.p_limit, 50);
  const rows = db.blood_requests
    .filter((r) => r.status === "active")
    .sort((a, b) => (a.required_by > b.required_by ? 1 : -1))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      blood_group: r.blood_group,
      blood_component: r.blood_component,
      units: r.units,
      hospital_name: r.hospital_name,
      hospital_locality: r.hospital_locality,
      urgency: r.urgency,
      required_by: r.required_by,
      status: r.status,
      note: r.note,
      created_at: r.created_at,
      donor_accepted: db.donor_alerts.some(
        (a) => a.request_id === r.id && a.response === "accepted",
      ),
      volunteers_assisting: db.request_assistance.filter(
        (s) => s.request_id === r.id && s.status === "offered",
      ).length,
      me_assisting: db.request_assistance.some(
        (s) => s.request_id === r.id && s.volunteer_id === who.id && s.status === "offered",
      ),
    }));
  return { data: rows, error: null };
}

/** A single request as a volunteer sees it. */
export function volunteerRequestDetail(
  args: Record<string, unknown>,
  who: Caller | null,
): RpcResult<unknown[]> {
  if (!who || (who.role !== "volunteer" && !isAdmin(who))) {
    return { data: [], error: null };
  }
  const id = String(args.p_request_id ?? "");
  const db = readDatabase();
  const r = db.blood_requests.find((x) => x.id === id);
  if (!r) return { data: [], error: null };
  return {
    data: [
      {
        id: r.id,
        blood_group: r.blood_group,
        blood_component: r.blood_component,
        units: r.units,
        hospital_name: r.hospital_name,
        hospital_locality: r.hospital_locality,
        urgency: r.urgency,
        required_by: r.required_by,
        status: r.status,
        note: r.note,
        created_at: r.created_at,
        donor_accepted: db.donor_alerts.some(
          (a) => a.request_id === r.id && a.response === "accepted",
        ),
        volunteers_assisting: db.request_assistance.filter(
          (s) => s.request_id === r.id && s.status === "offered",
        ).length,
        me_assisting: db.request_assistance.some(
          (s) => s.request_id === r.id && s.volunteer_id === who.id && s.status === "offered",
        ),
      },
    ],
    error: null,
  };
}


/* ------------------------------------------------------------------ admin */

/** Admin-only: every alert, newest first. */
export function adminListAlerts(
  args: Record<string, unknown>,
  who: Caller | null,
): RpcResult<unknown[]> {
  if (!isAdmin(who)) return { data: [], error: null };
  const db = readDatabase();
  const limit = limitOf(args.p_limit, 100);
  const rows = db.donor_alerts
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, limit)
    .map((a) => {
      const r = db.blood_requests.find((x) => x.id === a.request_id);
      return {
        alert_id: a.id,
        request_id: a.request_id,
        donor_id: a.donor_id,
        ring_km: a.ring_km,
        status: a.status,
        response: a.response,
        due_at: a.contact_shared_until ?? r?.required_by ?? a.created_at,
        created_at: a.created_at,
        responded_at: a.responded_at,
        accepted_at: a.accepted_at,
        blood_group: r?.blood_group ?? "",
        hospital_name: r?.hospital_name ?? "",
        hospital_locality: r?.hospital_locality ?? "",
      };
    });
  return { data: rows, error: null };
}

/** Admin-only: ring progression with how many alerts each ring produced. */
export function adminRingProgress(
  args: Record<string, unknown>,
  who: Caller | null,
): RpcResult<unknown[]> {
  if (!isAdmin(who)) return { data: [], error: null };
  const db = readDatabase();
  const limit = limitOf(args.p_limit, 50);
  const rows = db.ring_progress
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
    .slice(0, limit)
    .map((p) => {
      const r = db.blood_requests.find((x) => x.id === p.request_id);
      return {
        request_id: p.request_id,
        ring_index: p.ring_index,
        ring_km: p.ring_km,
        started_at: p.started_at,
        finished_at: p.finished_at,
        alerts_sent: db.donor_alerts.filter(
          (a) => a.request_id === p.request_id && a.ring_index === p.ring_index,
        ).length,
        outcome: p.outcome,
        request_status: r?.status ?? "",
        blood_group: r?.blood_group ?? "",
        hospital_name: r?.hospital_name ?? "",
        hospital_locality: r?.hospital_locality ?? "",
        required_by: r?.required_by ?? "",
      };
    });
  return { data: rows, error: null };
}

/**
 * Admin-only platform overview.
 *
 * Every number is counted from stored records. Nothing here is invented, and a
 * fresh install reports honest zeroes rather than plausible-looking figures.
 */
export function adminPlatformOverview(who: Caller | null): RpcResult<unknown[]> {
  if (!isAdmin(who)) return { data: [], error: null };
  const db = readDatabase();
  const dayAgo = Date.now() - 86_400_000;
  const byStatus = (status: string) =>
    db.blood_requests.filter((r) => r.status === status).length;
  const byRole = (role: string) => db.users.filter((u) => u.role === role).length;
  return {
    data: [
      {
        total_users: db.users.length,
        total_donors: byRole("donor"),
        total_requesters: byRole("requester"),
        total_volunteers: byRole("volunteer"),
        total_admins: byRole("admin"),
        suspended_users: db.users.filter((u) => u.status === "suspended").length,
        active_requests: byStatus("active"),
        fulfilled_requests: byStatus("fulfilled"),
        expired_requests: byStatus("expired"),
        cancelled_requests: byStatus("cancelled"),
        completed_donations: db.donation_history.length,
        open_reports: db.request_reports.filter((r) => r.status === "open").length,
        under_review_reports: db.request_reports.filter(
          (r) => r.status === "under_review",
        ).length,
        resolved_reports: db.request_reports.filter(
          (r) => r.status === "resolved" || r.status === "dismissed",
        ).length,
        reports_last_24h: db.request_reports.filter(
          (r) => new Date(r.created_at).getTime() >= dayAgo,
        ).length,
        active_alerts: db.donor_alerts.filter(
          (a) => a.status === "sent" || a.status === "opened" || a.status === "queued",
        ).length,
        accepted_alerts: db.donor_alerts.filter((a) => a.response === "accepted").length,
        available_donors: db.donor_profiles.filter((p) => p.availability === "available")
          .length,
      },
    ],
    error: null,
  };
}


/**
 * Matching summary for a request the caller owns (or an admin manages).
 * Ownership is enforced so nobody can inspect another requester's matching.
 * Column names mirror the SQL function exactly (within_3km) so the existing
 * caller's lookups keep working unchanged.
 */
export function matchingDonorStats(
  args: Record<string, unknown>,
  who: Caller | null,
): RpcResult<unknown[]> {
  if (!who) return { data: null, error: { message: "Not signed in." } };
  const id = String(args.p_request_id ?? "");
  const db = readDatabase();
  const r = db.blood_requests.find((x) => x.id === id);
  if (!r || (r.requester_id !== who.id && !isAdmin(who))) {
    return { data: null, error: { message: "No such request." } };
  }
  const eligible = db.donor_profiles.filter((p) => {
    const u = db.users.find((x) => x.id === p.user_id);
    return (
      !!u && u.status === "active" && u.role === "donor" && p.availability === "available"
    );
  });
  const withLoc = eligible.filter(
    (p) => p.latitude !== null && p.longitude !== null,
  );
  const band = (km: number) =>
    withLoc.filter((p) => {
      const d = approxKm(r, p);
      return d !== null && d <= km;
    }).length;
  return {
    data: [
      {
        is_active: r.status === "active",
        hospital_has_location: r.latitude !== null && r.longitude !== null,
        total_compatible: eligible.length,
        with_location: withLoc.length,
        within_3km: band(3),
        within_7km: band(7),
        within_15km: band(15),
      },
    ],
    error: null,
  };
}

/** Admin-only aggregate statistics for one campus drive. */
export function campusDriveStats(
  args: Record<string, unknown>,
  who: Caller | null,
): RpcResult<unknown[]> {
  if (!isAdmin(who)) return { data: [], error: null };
  const id = String(args.p_drive_id ?? "");
  const db = readDatabase();
  const drive = db.campus_blood_drives.find((d) => d.id === id);
  if (!drive) return { data: [], error: null };
  const regs = db.campus_drive_registrations.filter((g) => g.drive_id === id);
  // A tally by blood group, never a roster of who is in which group.
  const breakdown: Record<string, number> = {};
  for (const g of regs) {
    const p = db.donor_profiles.find((x) => x.user_id === g.donor_id);
    if (!p?.blood_group) continue;
    breakdown[p.blood_group] = (breakdown[p.blood_group] ?? 0) + 1;
  }
  return {
    data: [
      {
        registered: regs.length,
        checked_in: regs.filter((g) => g.status === "checked_in").length,
        participated: regs.filter((g) => g.status === "participated").length,
        cancelled: regs.filter((g) => g.status === "cancelled").length,
        units_collected: db.donation_history
          .filter((h) => h.drive_id === id)
          .reduce((s, h) => s + (h.units ?? 1), 0),
        target_units: drive.target_donors,
        group_breakdown: Object.keys(breakdown).length ? breakdown : null,
      },
    ],
    error: null,
  };
}

