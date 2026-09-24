import { requireRolePage } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { describeGap, formatDate, formatDateTime } from "@/lib/utils";
import {
  BLOOD_COMPONENT_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_STYLES,
  URGENCY_LABELS,
} from "@/lib/constants";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/States";
import { LiveRefresh } from "@/components/notifications/LiveRefresh";
import { RequestActions } from "@/components/requests/RequestActions";
import { RequestFilterBar } from "@/components/requests/RequestFilters";
import { RequestPager } from "@/components/requests/RequestPager";
import { RequestTable } from "@/components/requests/RequestTable";
import {
  PAGE_SIZE,
  URGENCY_RANK,
  hasActiveFilters,
  parseRequestFilters,
} from "@/lib/request-filters";
import { RequestCountdown } from "@/components/requests/RequestCountdown";
import { ALERT_RINGS_KM, ALERT_WINDOW_MINUTES } from "@/lib/constants";
import type { AcceptedDonor, BloodRequest, RequesterRingStatus } from "@/types";

export const metadata = { title: "Requester dashboard" };

// Session-gated: render per request so the role check is never baked into a
// static prerender (which would redirect forever in production).
export const dynamic = "force-dynamic";

export default async function RequesterDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, profile } = await requireRolePage("requester");
  const firstName = profile.full_name.trim().split(" ")[0];

  // History filters come from the URL and are whitelisted centrally; unknown
  // values fall back to "all" so a crafted query can never widen access.
  const filters = parseRequestFilters(await searchParams);
  const filtering = hasActiveFilters(filters);

  const supabase = await createSupabaseServerClient();

  // Active requests always stay actionable at the top (existing behaviour):
  // newest own active rows, bounded, with reveal + ring data attached.
  const { data: activeRows } = await supabase
    .from("blood_requests")
    .select("*")
    .eq("requester_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(10);

  const active = ((activeRows as BloodRequest[]) ?? []).filter(
    (r) => r.status === "active"
  );

  // History: database-side filtering + sorting + pagination over the caller's
  // OWN rows only. The .eq("requester_id") is explicit here (RLS enforces it
  // too) so history can never expose another requester's rows.
  let historyQuery = supabase
    .from("blood_requests")
    .select("*", { count: "exact" })
    .eq("requester_id", user.id);
  if (filters.status !== "all") historyQuery = historyQuery.eq("status", filters.status);
  if (filters.bloodGroup !== "all") historyQuery = historyQuery.eq("blood_group", filters.bloodGroup);
  if (filters.component !== "all") historyQuery = historyQuery.eq("blood_component", filters.component);
  if (filters.urgency !== "all") historyQuery = historyQuery.eq("urgency", filters.urgency);
  if (filters.from) historyQuery = historyQuery.gte("created_at", `${filters.from}T00:00:00Z`);
  if (filters.to) historyQuery = historyQuery.lte("created_at", `${filters.to}T23:59:59.999Z`);
  if (filters.urgency !== "all") historyQuery = historyQuery.eq("urgency", filters.urgency);
  historyQuery =
    filters.sort === "required_by"
      ? historyQuery.order("required_by", { ascending: true }).order("created_at", { ascending: false })
      : historyQuery.order("created_at", { ascending: false });
  const from = (filters.page - 1) * PAGE_SIZE;
  const { data: historyRows, count: historyTotal } = await historyQuery.range(from, from + PAGE_SIZE - 1);

  // "Most urgent first" ranks critical > urgent > routine within the page
  // (small bounded set — the DB already filtered and paginated it).
  const historyAll = ((historyRows as BloodRequest[]) ?? []).slice();
  if (filters.sort === "urgent") {
    historyAll.sort(
      (a, b) =>
        (URGENCY_RANK[a.urgency] ?? 3) - (URGENCY_RANK[b.urgency] ?? 3) ||
        new Date(a.required_by).getTime() - new Date(b.required_by).getTime()
    );
  }
  const historyCount = historyTotal ?? historyAll.length;

  // Sidebar counts stay honest without loading every row: one bounded
  // head-count per lifecycle bucket, own rows only.
  const [{ count: fulfilledCount }, { count: totalCount }] = await Promise.all([
    supabase
      .from("blood_requests")
      .select("id", { count: "exact", head: true })
      .eq("requester_id", user.id)
      .eq("status", "fulfilled"),
    supabase
      .from("blood_requests")
      .select("id", { count: "exact", head: true })
      .eq("requester_id", user.id),
  ]);

  const list = Array.from(
    new Map(
      [...active, ...historyAll].map((r) => [r.id, r])
    ).values()
  );

  // Post-acceptance reveal + ring-engine progress — both SECURITY DEFINER,
  // own-requests only (migration 0011). Donor contact appears only while the
  // database still reports contact_shared_until; nothing is derivable here.
  const requestIds = list.map((r) => r.id);
  const [{ data: revealRows }, { data: ringRows }] = await Promise.all([
    supabase.rpc("reveal_accepted_donors", { p_request_ids: requestIds }),
    supabase.rpc("requester_ring_status", { p_request_ids: requestIds }),
  ]);
  const acceptedByRequest = new Map<string, AcceptedDonor>(
    ((revealRows as AcceptedDonor[] | null) ?? []).map((d) => [d.request_id, d])
  );
  const ringsByRequest = new Map<string, RequesterRingStatus>();
  for (const row of (ringRows as RequesterRingStatus[] | null) ?? []) {
    const seen = ringsByRequest.get(row.request_id);
    if (!seen || row.ring_index > seen.ring_index) {
      ringsByRequest.set(row.request_id, row);
    }
  }

  const alertedByRequest = new Map<string, number>();
  for (const row of (ringRows as RequesterRingStatus[] | null) ?? []) {
    alertedByRequest.set(
      row.request_id,
      (alertedByRequest.get(row.request_id) ?? 0) + row.alerts_sent
    );
  }

  function RequestCard({ request }: { request: BloodRequest }) {
    const isActive = request.status === "active";
    const pastDeadline = new Date(request.required_by).getTime() < Date.now();
    const ring = ringsByRequest.get(request.id);
    const acceptedDonor = acceptedByRequest.get(request.id);
    const alerted = alertedByRequest.get(request.id) ?? 0;
    return (
      <Card glass={isActive}>
        <CardBody className="pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-2xl font-extrabold text-blood-700">
              {request.blood_group}
            </span>
            <span className="text-base font-semibold text-ink-900">
              {BLOOD_COMPONENT_LABELS[request.blood_component]} · {request.units}{" "}
              {request.units === 1 ? "unit" : "units"}
            </span>
            <span
              className={`rounded-md px-3 py-1 text-sm font-bold ${REQUEST_STATUS_STYLES[request.status]}`}
            >
              {REQUEST_STATUS_LABELS[request.status]}
            </span>
            {isActive && pastDeadline && (
              <span className="rounded-md bg-ink-100 px-3 py-1 text-sm font-bold text-ink-600">
                Past deadline
              </span>
            )}
          </div>

          <p className="mt-3 text-lg font-bold text-ink-900">
            {request.hospital_name}
            <span className="font-medium text-ink-600"> — {request.hospital_locality}</span>
          </p>
          <p className="mt-1 text-base text-ink-600">
            {URGENCY_LABELS[request.urgency]} · Required by{" "}
            {formatDateTime(request.required_by)}
            {isActive && (
              <>
                {" — "}
                <RequestCountdown
                  deadlineIso={request.required_by}
                  fallback={describeGap(new Date(request.required_by).getTime() - Date.now())}
                />
              </>
            )}
          </p>
          {request.note && <p className="mt-2 text-base text-ink-600">{request.note}</p>}
          <p className="mt-2 text-sm text-ink-600">
            {request.hospital_latitude !== null && request.hospital_longitude !== null
              ? "Hospital area pinned (approximate) — donors will be distance-sorted."
              : "No map pin for this hospital — donors are matched by locality text."}
          </p>

          {ring && (
            <p className="mt-2 text-sm text-ink-600">
              {ring.finished_at === null ? (
                <>
                  Alert ring {ring.ring_index} of {ALERT_RINGS_KM.length} live —
                  donors within {ring.ring_km} km ({ring.alerts_sent} alerted,
                  renews every {ALERT_WINDOW_MINUTES} minutes until someone
                  accepts or the rings run out).
                </>
              ) : (
                <>
                  Ring process finished at ring {ring.ring_index} ({ring.ring_km}
                  km, {ring.alerts_sent} alerted) —{" "}
                  {ring.outcome === "accepted"
                    ? "a donor accepted."
                    : ring.outcome === "rings_exhausted"
                      ? "all rings completed without an acceptance."
                      : "the request closed."}
                </>
              )}
            </p>
          )}

          {ring && ring.finished_at !== null && alerted > 0 && (
            <p className="mt-1 text-sm text-ink-600">
              {alerted} {alerted === 1 ? "donor was" : "donors were"} alerted in total
              before the rings stopped.
            </p>
          )}
          {acceptedDonor && (
            <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-green-900">
              <p className="font-bold">Accepted donor — coordinate directly</p>
              <p className="mt-1 text-base">
                {acceptedDonor.donor_name} ·{" "}
                <a
                  href={`tel:${acceptedDonor.donor_phone}`}
                  className="font-bold underline"
                >
                  {acceptedDonor.donor_phone}
                </a>
              </p>
              <p className="mt-1 text-sm">
                {acceptedDonor.donor_blood_group} ·{" "}
                {acceptedDonor.donor_locality} · contact is visible here until
                the response deadline. Final eligibility is the blood
                bank&apos;s screening decision.
              </p>
            </div>
          )}

          {!isActive && (
            <p className="mt-3 rounded-md bg-ink-50 px-4 py-3 text-sm text-ink-600">
              {request.status === "fulfilled"
                ? "Fulfilled — this request is closed and donors are no longer alerted."
                : request.status === "cancelled"
                  ? "Cancelled — no further alerts are sent. Create a new request if blood is needed again."
                  : "Expired — the deadline passed and the request is closed. Create a new request if blood is still needed."}
            </p>
          )}

          {isActive && <RequestActions requestId={request.id} />}

          <div className="mt-4 flex flex-wrap gap-3">
            <ButtonLink href={`/requests/${request.id}`} variant="secondary">
              View details
            </ButtonLink>
            {isActive && (
              <ButtonLink href={`/requests/${request.id}/matches`} variant="ghost">
                Matching donors
              </ButtonLink>
            )}
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <>
      {/* One shared live signal for the whole app: refetch on focus/visibility
          plus a best-effort realtime INSERT on notifications. The page stays
          fully usable when realtime is unavailable. */}
      <LiveRefresh />

      <PageHeader
        eyebrow="Requester dashboard"
        title={`Hi, ${firstName}`}
        description="You run blood requests for the people who need them — the patient never has to."
      />

      <Section>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="glass flex flex-wrap gap-x-10 gap-y-4 rounded-lg px-6 py-5">
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
                Active requests
              </p>
              <p className="text-2xl font-extrabold text-ink-900">{active.length}</p>
            </div>
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
                Fulfilled
              </p>
              <p className="text-2xl font-extrabold text-ink-900">
                {fulfilledCount ?? 0}
              </p>
            </div>
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
                Total
              </p>
              <p className="text-2xl font-extrabold text-ink-900">{totalCount ?? active.length}</p>
            </div>
          </div>
          <ButtonLink href="/request-blood">+ New blood request</ButtonLink>
        </div>

        <h2 className="mt-12 text-2xl font-extrabold tracking-tight text-ink-900">
          Active requests
        </h2>
        <div className="mt-6 space-y-6">
          {active.length === 0 ? (
            <EmptyState
              title={(totalCount ?? active.length) === 0 ? "No requests yet" : "No active requests"}
              description={
                (totalCount ?? active.length) === 0
                  ? "When someone needs blood, create a request and RaktSetu alerts matching donors near that hospital — nearest ring first, widening until someone accepts. Requests you close stay below with their outcome."
                  : "Nothing is being alerted right now. Open a new request the moment blood is needed and matching starts immediately."
              }
              action={
                <ButtonLink href="/request-blood">Create a blood request</ButtonLink>
              }
            />
          ) : (
            active.map((r) => <RequestCard key={r.id} request={r} />)
          )}
        </div>

        <h2 className="mt-12 text-2xl font-extrabold tracking-tight text-ink-900">
          Request history — newest first unless sorted otherwise
        </h2>
        <p className="mt-2 max-w-2xl text-base text-ink-600">
          Every request you created — active, fulfilled, expired, and
          cancelled — with its blood group, component, units, hospital,
          urgency, required-by time, status, and when it was created.
          Filtering happens in the database over your rows only, {PAGE_SIZE}{" "}
          at a time. Closed requests are read-only; open one to see its
          outcome.
        </p>
        <div className="mt-6">
          <RequestFilterBar filters={filters} basePath="/dashboard/requester" />
        </div>
        <div className="mt-6">
          <RequestTable
            rows={historyAll}
            detailsHref={(id) => `/requests/${id}`}
            emptyTitle={
              filtering
                ? "No requests match these filters"
                : (totalCount ?? 0) === 0
                  ? "No request history yet"
                  : "No requests on this page"
            }
            emptyDescription={
              filtering
                ? "Try widening the status, blood group, component, urgency, or date range — or clear the filters to see everything."
                : "When someone needs blood, create a request above. Fulfilled, expired, and cancelled requests stay here with their outcome."
            }
          />
          <RequestPager
            filters={filters}
            basePath="/dashboard/requester"
            total={historyCount}
            pageSize={PAGE_SIZE}
          />
        </div>

        <Alert variant="info" title="Your contact details are protected" className="mt-10">
          The phone number on a request is stored privately and is never listed
          publicly — donors who are merely alerted see only your hospital&apos;s
          area and an approximate distance. When a donor accepts, you see each
          other&apos;s contact on these dashboards only, and only until the
          response deadline, so you can coordinate the donation directly. Final
          donor eligibility is always decided by the blood bank&apos;s medical
          screening.
        </Alert>
      </Section>
    </>
  );
}
