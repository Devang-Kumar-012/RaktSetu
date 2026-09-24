import { requireRolePage } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  PAGE_SIZE,
  URGENCY_RANK,
  hasActiveFilters,
  parseRequestFilters,
} from "@/lib/request-filters";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { RequestFilterBar } from "@/components/requests/RequestFilters";
import { RequestPager } from "@/components/requests/RequestPager";
import { RequestTable } from "@/components/requests/RequestTable";
import type { BloodRequest } from "@/types";

export const metadata = { title: "Requests — admin" };

export const dynamic = "force-dynamic";

/**
 * Full request oversight. blood_requests has an admin SELECT policy (0004);
 * lifecycle rules and expiry are untouched — this view only reads.
 *
 * Practical search/filtering with bounded, database-side queries: status,
 * blood group, component, urgency, created-date range, and a hospital /
 * locality keyword — paginated one page at a time so a large history never
 * lands in the browser at once.
 */
export default async function AdminRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseRequestFilters(await searchParams, { allowSearch: true });
  const filtering = hasActiveFilters(filters, { allowSearch: true });

  // Server-side admin gate FIRST: layout already requires admin, but this
  // explicit check keeps the data boundary obvious and testable.
  await requireRolePage("admin");

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("blood_requests")
    .select(
      "id, blood_group, blood_component, units, hospital_name, hospital_locality, urgency, required_by, note, status, requester_id, created_at",
      { count: "exact" }
    );
  if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.bloodGroup !== "all") query = query.eq("blood_group", filters.bloodGroup);
  if (filters.component !== "all") query = query.eq("blood_component", filters.component);
  if (filters.urgency !== "all") query = query.eq("urgency", filters.urgency);
  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00Z`);
  if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59.999Z`);
  // Keyword search stays bound to two hospital text columns. Commas would
  // split PostgREST `or` conditions, so they become spaces; other wildcard
  // characters are stripped before the ilike match.
  if (filters.q) {
    const safe = filters.q.replace(/[%_,()\\"]/g, "").replace(/,/g, " ").trim().slice(0, 80);
    if (safe.trim()) {
      const like = `%${safe.trim()}%`;
      query = query.or(
        `hospital_name.ilike.${like},hospital_locality.ilike.${like}`
      );
    }
  }
  // DB ordering stays on two stable timestamp columns (created_at and
  // required_by both have DB indexes) so every page is deterministic; the
  // "most urgent first" emergency rank (critical > urgent > routine) is
  // applied in memory over this bounded page, where it is easy to scan.
  query =
    filters.sort === "required_by" || filters.sort === "urgent"
      ? query.order("required_by", { ascending: true }).order("created_at", { ascending: false })
      : query.order("created_at", { ascending: false });
  const from = (filters.page - 1) * PAGE_SIZE;
  const { data, count } = await query.range(from, from + PAGE_SIZE - 1);

  const requests = ((data as BloodRequest[] | null) ?? []).slice();
  // "Most urgent first" ranks critical > urgent > routine, then the earliest
  // deadline, within this bounded page (DB ordering is text-based, so the
  // final emergency rank happens here over at most PAGE_SIZE rows).
  if (filters.sort === "urgent") {
    requests.sort(
      (a, b) =>
        (URGENCY_RANK[a.urgency] ?? 3) - (URGENCY_RANK[b.urgency] ?? 3) ||
        new Date(a.required_by).getTime() - new Date(b.required_by).getTime()
    );
  }
  const total = count ?? requests.length;
  const activeOnPage = requests.filter((r) => r.status === "active").length;

  return (
    <>
      <PageHeader
        eyebrow="Admin · Requests"
        title="Blood request oversight"
        description={`${total} ${total === 1 ? "request" : "requests"} in scope · ${activeOnPage} active on this page. Database-filtered and paginated — lifecycle rules are unchanged, the requester always owns fulfill/cancel.`}
      />
      <Section>
        <RequestFilterBar filters={filters} basePath="/admin/requests" allowSearch />
        <div className="mt-6">
          <RequestTable
            rows={requests}
            showRequester
            emptyTitle={filtering ? "No requests match these filters" : "No requests yet"}
            emptyDescription={
              filtering
                ? "Try widening the status, blood group, component, urgency, date range, or hospital keyword — or clear the filters."
                : "Blood requests created by requesters will appear here for oversight."
            }
          />
          <RequestPager
            filters={filters}
            basePath="/admin/requests"
            total={total}
            pageSize={PAGE_SIZE}
            allowSearch
          />
        </div>
        <p className="mt-8 max-w-2xl text-base text-ink-600">
          Read-only oversight: fulfill and cancel stay with the owning requester
          through the existing request actions. Urgency (critical first) and the
          required-by time stay visible in every row so emergencies scan fast.
        </p>
      </Section>
    </>
  );
}
