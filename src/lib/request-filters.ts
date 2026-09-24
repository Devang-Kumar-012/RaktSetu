/**
 * Shared request-discovery helpers (Prompt 24).
 *
 * Single source of truth for requester-history + admin-oversight filtering,
 * sorting, and pagination. Both pages reuse these so there is exactly ONE
 * request-management model:
 *  - requesters read ONLY their own rows (requester_id = auth.uid(), enforced
 *    by RLS + an explicit .eq in the query builder)
 *  - admins read via the existing admin SELECT policy (0004) + requireRolePage
 *  - filtering/sorting/pagination happen database-side (no full-table fetch)
 *  - closed requests (fulfilled/cancelled/expired) are always read-only;
 *    lifecycle mutations stay in src/lib/actions/requests.ts only
 *  - Unknown values fall back to "all" (or safe defaults), so a crafted
 *    query string can never widen access or break the query builder.
 */

import type { BloodComponent, BloodRequestStatus, RequestUrgency } from "@/types";

export const REQUEST_STATUSES: BloodRequestStatus[] = ["active", "fulfilled", "expired", "cancelled"];
export const REQUEST_BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const REQUEST_COMPONENTS: BloodComponent[] = ["whole_blood", "platelets"];
export const REQUEST_URGENCIES: RequestUrgency[] = ["routine", "urgent", "critical"];

/** Sort modes offered on both history surfaces. */
export const REQUEST_SORTS = ["newest", "required_by", "urgent"] as const;
export type RequestSort = (typeof REQUEST_SORTS)[number];

export const PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

export interface RequestFilters {
  status: BloodRequestStatus | "all";
  bloodGroup: string | "all";
  component: BloodComponent | "all";
  urgency: RequestUrgency | "all";
  from: string | null; // YYYY-MM-DD
  to: string | null; // YYYY-MM-DD
  q: string; // admin-only free text (hospital / locality)
  sort: RequestSort;
  page: number; // 1-based
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

/** Parse + whitelist URL search params. Unknown values fall back to "all". */
export function parseRequestFilters(
  params: Record<string, string | string[] | undefined>,
  opts: { allowSearch?: boolean } = {}
): RequestFilters {
  const statusRaw = first(params.status).trim();
  const groupRaw = first(params.group ?? params.bloodGroup).trim();
  const compRaw = first(params.component).trim();
  const urgencyRaw = first(params.urgency).trim();
  const fromRaw = first(params.from).trim();
  const toRaw = first(params.to).trim();
  const qRaw = opts.allowSearch ? first(params.q).trim().slice(0, 80) : "";
  const sortRaw = first(params.sort).trim();
  const pageRaw = Number.parseInt(first(params.page).trim(), 10);

  const status: RequestFilters["status"] = (REQUEST_STATUSES as string[]).includes(statusRaw)
    ? (statusRaw as BloodRequestStatus)
    : "all";
  const bloodGroup: RequestFilters["bloodGroup"] = (REQUEST_BLOOD_GROUPS as readonly string[]).includes(groupRaw)
    ? groupRaw
    : "all";
  const component: RequestFilters["component"] = (REQUEST_COMPONENTS as string[]).includes(compRaw)
    ? (compRaw as BloodComponent)
    : "all";
  const urgency: RequestFilters["urgency"] = (REQUEST_URGENCIES as string[]).includes(urgencyRaw)
    ? (urgencyRaw as RequestUrgency)
    : "all";
  const sort: RequestSort = (REQUEST_SORTS as readonly string[]).includes(sortRaw)
    ? (sortRaw as RequestSort)
    : "newest";

  return {
    status,
    bloodGroup,
    component,
    urgency,
    from: isValidDate(fromRaw) ? fromRaw : null,
    to: isValidDate(toRaw) ? toRaw : null,
    q: qRaw,
    sort,
    page: Number.isFinite(pageRaw) && pageRaw >= 1 && pageRaw <= 1000 ? Math.floor(pageRaw) : 1,
  };
}

/** True when any filter narrows the default view (used for empty-state copy). */
export function hasActiveFilters(f: RequestFilters, opts: { allowSearch?: boolean } = {}): boolean {
  return Boolean(
    f.status !== "all" ||
    f.bloodGroup !== "all" ||
    f.component !== "all" ||
    f.urgency !== "all" ||
    f.from !== null ||
    f.to !== null ||
    (opts.allowSearch === true && f.q !== "")
  );
}

/** Encode filters back into a query string, omitting defaults. */
export function filtersToSearchParams(
  f: RequestFilters,
  opts: { allowSearch?: boolean } = {}
): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status !== "all") p.set("status", f.status);
  if (f.bloodGroup !== "all") p.set("group", f.bloodGroup);
  if (f.component !== "all") p.set("component", f.component);
  if (f.urgency !== "all") p.set("urgency", f.urgency);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (opts.allowSearch && f.q) p.set("q", f.q);
  if (f.sort !== "newest") p.set("sort", f.sort);
  if (f.page > 1) p.set("page", String(f.page));
  return p;
}

/** Urgency rank for display sorting: critical first, then urgent, routine. */
export const URGENCY_RANK: Record<string, number> = { critical: 0, urgent: 1, routine: 2 };
