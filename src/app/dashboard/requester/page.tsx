import { requireRolePage } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/utils";
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
import { RequestActions } from "@/components/requests/RequestActions";
import type { BloodRequest } from "@/types";

export const metadata = { title: "Requester dashboard" };

export default async function RequesterDashboardPage() {
  const { user, profile } = await requireRolePage("requester");
  const firstName = profile.full_name.trim().split(" ")[0];

  const supabase = await createSupabaseServerClient();
  const { data: requests } = await supabase
    .from("blood_requests")
    .select("*")
    .eq("requester_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const list = (requests as BloodRequest[]) ?? [];
  const active = list.filter((r) => r.status === "active");
  const past = list.filter((r) => r.status !== "active");

  function RequestCard({ request }: { request: BloodRequest }) {
    const isActive = request.status === "active";
    const pastDeadline = new Date(request.required_by).getTime() < Date.now();
    return (
      <Card>
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
          </p>
          {request.note && <p className="mt-2 text-base text-ink-600">{request.note}</p>}
          <p className="mt-2 text-sm text-ink-600">
            {request.hospital_latitude !== null && request.hospital_longitude !== null
              ? "Hospital area pinned (approximate) — donors will be distance-sorted."
              : "No map pin for this hospital — donors are matched by locality text."}
          </p>

          {isActive && <RequestActions requestId={request.id} />}
        </CardBody>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Requester dashboard"
        title={`Hi, ${firstName}`}
        description="You run blood requests for the people who need them — the patient never has to."
      />

      <Section>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-x-10 gap-y-4">
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
                {list.filter((r) => r.status === "fulfilled").length}
              </p>
            </div>
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
                Total
              </p>
              <p className="text-2xl font-extrabold text-ink-900">{list.length}</p>
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
              title="No active requests"
              description="When someone needs blood, create a request and RaktSetu will look for matching donors near that hospital."
              action={
                <ButtonLink href="/request-blood">Create a blood request</ButtonLink>
              }
            />
          ) : (
            active.map((r) => <RequestCard key={r.id} request={r} />)
          )}
        </div>

        <h2 className="mt-12 text-2xl font-extrabold tracking-tight text-ink-900">
          Past requests
        </h2>
        <div className="mt-6 space-y-6">
          {past.length === 0 ? (
            <EmptyState
              title="No past requests yet"
              description="Fulfilled, expired, and cancelled requests will appear here."
            />
          ) : (
            past.map((r) => <RequestCard key={r.id} request={r} />)
          )}
        </div>

        <Alert variant="info" title="Your contact details are protected" className="mt-10">
          The phone number on a request is stored privately and is never listed publicly.
          Donors only ever see your area and an approximate distance, not your number.
          Sharing a number with one chosen donor is a later feature — for now, you stay in
          control of who you give it to. Final donor eligibility is always decided by the
          blood bank&apos;s medical screening.
        </Alert>
      </Section>
    </>
  );
}
