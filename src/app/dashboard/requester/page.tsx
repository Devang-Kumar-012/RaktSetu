"use client";

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
import { useClientAuth } from "@/components/local/useClientAuth";
import type { BrowserDataClient } from "@/lib/supabase/client";
import type { AuthenticatedUser } from "@/types";
import type { AcceptedDonor, BloodRequest, RequesterRingStatus } from "@/types";

// NOTE: a Client Component may not export `metadata` or `dynamic`; the route
// title lives in ./layout.tsx. This page must be a client component because it
// runs its loader after the client session guard has resolved.

interface RequesterDashboardData {
  firstName: string;
  list: BloodRequest[];
  active: BloodRequest[];
  historyAll: BloodRequest[];
  historyCount: number;
  fulfilledCount: number;
  totalCount: number;
  filters: ReturnType<typeof parseRequestFilters>;
  filtering: boolean;
  acceptedByRequest: Map<string, AcceptedDonor>;
  ringsByRequest: Map<string, RequesterRingStatus>;
  alertedByRequest: Map<string, number>;
}

/**
 * A stored request row as the dashboard's `BloodRequest` contract.
 *
 * The store keeps the requester's own contact as `requester_name` /
 * `requester_phone` and the hospital pin as `latitude` / `longitude`, while
 * the UI and the `BloodRequest` interface name them `contact_*` /
 * `hospital_*`. Translating in ONE place is what stops the card from reading
 * `undefined` — which is `!== null`, so it would claim every request carries
 * a map pin when it does not.
 *
 * `fulfilled_at` / `cancelled_at` are null because SQLite records the outcome
 * in `status` alone; nothing on this page reads them, and inventing a
 * timestamp would be worse than showing none.
 */
type StoredRequestRow = Omit<
  BloodRequest,
  "contact_name" | "contact_phone" | "hospital_latitude" | "hospital_longitude" | "fulfilled_at" | "cancelled_at"
> & {
  requester_name?: string | null;
  requester_phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

function toBloodRequest(row: StoredRequestRow): BloodRequest {
  return {
    ...row,
    contact_name: row.requester_name ?? "",
    contact_phone: row.requester_phone ?? "",
    hospital_latitude: row.latitude ?? null,
    hospital_longitude: row.longitude ?? null,
    fulfilled_at: null,
    cancelled_at: null,
  };
}

/**
 * Reads the requester's OWN requests, in the browser.
 *
 * The chain is unchanged from when it read the visitor's localStorage: it now
 * crosses a server action, where the caller is derived from the HTTP-only
 * session cookie and `.eq("requester_id", user.id)` is ANDed in again by the
 * server — so the scope holds even if this payload said otherwise.
 */
async function loadRequesterDashboard(
  supabase: BrowserDataClient,
  user: AuthenticatedUser
): Promise<RequesterDashboardData> {
  const firstName = user.full_name.trim().split(" ")[0];

  // History filters come from the URL and are whitelisted centrally; unknown
  // values fall back to "all" so a crafted query can never widen access. Read
  // from location.search — this loader runs in the browser, after mount.
  const params = Object.fromEntries(
    new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).entries()
  );
  const filters = parseRequestFilters(params);
  const filtering = hasActiveFilters(filters);

  // Active requests always stay actionable at the top: newest own active rows,
  // bounded, with reveal + ring data attached.
  const { data: activeRows } = await supabase
    .from("blood_requests")
    .select("*")
    .eq("requester_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(10);

  const active = ((activeRows as StoredRequestRow[]) ?? [])
    .filter((r) => r.status === "active")
    .map(toBloodRequest);

  // History: filtered, sorted and paginated over the caller's OWN rows only.
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
  historyQuery =
    filters.sort === "required_by"
      ? historyQuery.order("required_by", { ascending: true }).order("created_at", { ascending: false })
      : historyQuery.order("created_at", { ascending: false });
  const from = (filters.page - 1) * PAGE_SIZE;
  const { data: historyRows, count: historyTotal } = await historyQuery.range(from, from + PAGE_SIZE - 1);

  // "Most urgent first" ranks critical > urgent > routine within the page
  // (small bounded set — the store already filtered and paginated it).
  const historyAll = ((historyRows as StoredRequestRow[]) ?? []).map(toBloodRequest);
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
    new Map([...active, ...historyAll].map((r) => [r.id, r])).values()
  );

  // Post-acceptance reveal + ring-engine progress — own-requests only. Donor
  // contact appears ONLY while the store still reports it as shareable; nothing
  // is derivable here.
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

  return {
    firstName,
    list,
    active,
    historyAll,
    historyCount,
    // A head-count is `null` only when the read failed. The sidebar must
    // still render a number, and "0" is the honest answer for a store with
    // no matching rows.
    fulfilledCount: fulfilledCount ?? 0,
    totalCount: totalCount ?? 0,
    filters,
    filtering,
    acceptedByRequest,
    ringsByRequest,
    alertedByRequest,
  };
}

export default function RequesterDashboardPage() {
  const auth = useClientAuth("requester", loadRequesterDashboard, "/dashboard/requester");

  // Terminal loading state: the hook always settles, so this cannot hang.
  if (auth.status === "checking") {
    return (
      <Section>
        <p role="status" className="text-lg text-ink-600">
          Loading your requests…
        </p>
      </Section>
    );
  }
  if (auth.status !== "ready") return null;

  const {
    firstName,
    list,
    active,
    historyAll,
    historyCount,
    fulfilledCount,
    totalCount,
    filters,
    filtering,
    acceptedByRequest,
    ringsByRequest,
    alertedByRequest,
  } = auth.data;

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
