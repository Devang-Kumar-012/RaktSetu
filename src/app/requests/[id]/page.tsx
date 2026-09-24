import { notFound, redirect } from "next/navigation";

import { getSessionInfo } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { describeGap, formatDateTime } from "@/lib/utils";
import { LiveRefresh } from "@/components/notifications/LiveRefresh";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { RequestActions } from "@/components/requests/RequestActions";
import { RequestCountdown } from "@/components/requests/RequestCountdown";
import { RequestReportForm } from "@/components/requests/RequestReportForm";
import {
  ALERT_RINGS_KM,
  ALERT_WINDOW_MINUTES,
  BLOOD_COMPONENT_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_STYLES,
  URGENCY_LABELS,
} from "@/lib/constants";
import type { AcceptedDonor, BloodRequest, RequesterRingStatus } from "@/types";

export const metadata = { title: "Request details" };

// Session-gated: the ownership check must run per request, never be baked
// into a static prerender.
export const dynamic = "force-dynamic";

function isUuid(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

/** One labelled row in the request fact sheet. */
function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-bold uppercase tracking-widest text-ink-400">{label}</dt>
      <dd className="mt-1 text-base font-medium text-ink-900">{value}</dd>
    </div>
  );
}

/** Closing copy for each terminal lifecycle state — plain, no blame. */
const CLOSED_COPY: Record<string, { title: string; body: string }> = {
  fulfilled: {
    title: "Fulfilled — this request is closed",
    body: "Donors are no longer alerted. Anyone who accepted before you closed it keeps the contact you were given until the response window ends. Final donor eligibility is always the blood bank's screening decision.",
  },
  cancelled: {
    title: "Cancelled — this request is closed",
    body: "No further alerts are sent and matching has stopped for this request. If blood is still needed, create a new request so donors near the hospital are alerted again.",
  },
  expired: {
    title: "Expired — the deadline passed without an acceptance",
    body: "The alert process ended on its own. If the need is still there, create a new request with a fresh required-by time so donors nearby are alerted again.",
  },
};

/**
 * Requester-owned request details: everything about one request in one place —
 * its facts, ring-by-ring alert progress, any accepted donor, the live time
 * left, and the actions that close it.
 *
 * Every value is server-resolved for THIS user (own-request RLS plus the
 * own-request SECURITY DEFINER functions in migration 0011). A request the
 * caller does not own is indistinguishable from one that does not exist.
 */
export default async function RequestDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const session = await getSessionInfo();
  if (!session.configured || !session.user) redirect(`/login?next=/requests/${id}`);
  if (!session.profile || session.profile.role !== "requester") redirect("/dashboard");

  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from("blood_requests")
    .select("*")
    .eq("id", id)
    .eq("requester_id", session.user.id)
    .maybeSingle();

  if (!row) notFound();
  const request = row as BloodRequest;

  // Post-acceptance reveal (null once contact_shared_until has passed) and
  // ring-engine progress — both own-request only.
  const [{ data: revealRows }, { data: ringRows }, { data: ownReports }] =
    await Promise.all([
      supabase.rpc("reveal_accepted_donors", { p_request_ids: [request.id] }),
      supabase.rpc("requester_ring_status", { p_request_ids: [request.id] }),
      // Own-row RLS scopes this to the caller's own reports, so it can only
      // ever say "you already reported this" — never anything about others.
      supabase
        .from("request_reports")
        .select("id")
        .eq("request_id", request.id)
        .eq("reporter_id", session.user.id)
        .limit(1),
    ]);

  const alreadyReported = (ownReports ?? []).length > 0;

  const acceptedDonor = ((revealRows as AcceptedDonor[] | null) ?? [])[0] ?? null;
  const rings = ((ringRows as RequesterRingStatus[] | null) ?? [])
    .slice()
    .sort((a, b) => a.ring_index - b.ring_index);
  const latestRing = rings.length > 0 ? rings[rings.length - 1] : null;
  const alertsSent = rings.reduce((total, ring) => total + ring.alerts_sent, 0);

  const isActive = request.status === "active";
  const deadlineMs = new Date(request.required_by).getTime();
  const pastDeadline = deadlineMs < Date.now();
  const closedCopy = CLOSED_COPY[request.status] ?? null;
  const ringsExhausted = latestRing?.outcome === "rings_exhausted";

  return (
    <>
      {/* Live updates ride the existing notifications signal — no second
          real-time system anywhere in RaktSetu. */}
      <LiveRefresh />

      <PageHeader
        eyebrow="Request details"
        title={`${request.blood_group} · ${BLOOD_COMPONENT_LABELS[request.blood_component]}`}
        description={`${request.units} ${request.units === 1 ? "unit" : "units"} needed at ${request.hospital_name}, ${request.hospital_locality}.`}
      />

      <Section className="max-w-3xl">
        <Card glass={isActive}>
          <CardBody className="pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`rounded-md px-3 py-1 text-sm font-bold ${REQUEST_STATUS_STYLES[request.status]}`}
              >
                {REQUEST_STATUS_LABELS[request.status]}
              </span>
              <span className="text-base font-semibold text-ink-900">
                {URGENCY_LABELS[request.urgency]}
              </span>
              {isActive && pastDeadline && (
                <span className="rounded-md bg-ink-100 px-3 py-1 text-sm font-bold text-ink-600">
                  Past deadline
                </span>
              )}
            </div>

            <p className="mt-4 text-lg font-bold text-ink-900">
              Required by {formatDateTime(request.required_by)}
              {isActive && (
                <>
                  {" — "}
                  <RequestCountdown
                    deadlineIso={request.required_by}
                    fallback={describeGap(deadlineMs - Date.now())}
                  />
                </>
              )}
            </p>
            <p className="mt-1 text-base text-ink-600">
              Created {formatDateTime(request.created_at)}
            </p>

            {isActive && <RequestActions requestId={request.id} />}
          </CardBody>
        </Card>

        {/* --- What is happening right now, and what can still be done --- */}
        {isActive && pastDeadline && (
          <Alert variant="warning" title="The required-by time has passed" className="mt-8">
            The request is still active, so a donor can still accept — but the deadline
            itself has passed. If blood has been arranged, mark it fulfilled; if it is no
            longer needed, cancel it. Otherwise the system will expire it for you.
          </Alert>
        )}

        {isActive && latestRing === null && (
          <Alert variant="info" title="Alerts are starting" className="mt-8">
            Donors in the nearest ring (within {ALERT_RINGS_KM[0]} km) are being alerted
            now. Each alert renews every {ALERT_WINDOW_MINUTES} minutes, and the search
            widens ring by ring until someone accepts or the rings run out.
          </Alert>
        )}

        {isActive && ringsExhausted && (
          <Alert
            variant="warning"
            title="Every ring completed without an acceptance"
            className="mt-8"
          >
            All {ALERT_RINGS_KM.length} rings (up to{" "}
            {ALERT_RINGS_KM[ALERT_RINGS_KM.length - 1]} km) finished, with {alertsSent}{" "}
            {alertsSent === 1 ? "donor" : "donors"} alerted and nobody accepting. No one
            can accept this request any more — if blood is still needed, create a new
            request so donors are alerted on a fresh pass.
          </Alert>
        )}

        {closedCopy && (
          <Alert variant="info" title={closedCopy.title} className="mt-8">
            {closedCopy.body}
          </Alert>
        )}

        {acceptedDonor && (
          <div className="mt-8 rounded-md border border-green-200 bg-green-50 px-5 py-4 text-green-900">
            <p className="text-lg font-bold">Accepted donor — coordinate directly</p>
            <p className="mt-2 text-base">
              {acceptedDonor.donor_name} ·{" "}
              <a href={`tel:${acceptedDonor.donor_phone}`} className="font-bold underline">
                {acceptedDonor.donor_phone}
              </a>
            </p>
            <p className="mt-1 text-sm">
              {acceptedDonor.donor_blood_group} · {acceptedDonor.donor_locality} · this
              contact stays visible on your pages only until the response window closes.
              Final eligibility is the blood bank&apos;s screening decision.
            </p>
          </div>
        )}

        {isActive && !acceptedDonor && !ringsExhausted && !pastDeadline && (
          <Alert variant="info" title="Nobody has accepted yet" className="mt-8">
            Alerted donors see the hospital area, the blood group, and an approximate
            distance — never your phone number. Contact details are revealed to you and to
            a donor only after that donor accepts this request.
          </Alert>
        )}

        <h2 className="mt-12 text-2xl font-extrabold tracking-tight text-ink-900">
          Alert progress
        </h2>
        <p className="mt-2 text-base text-ink-600">
          Alerts widen ring by ring — nearest donors first, one ring at a time.{" "}
          {alertsSent > 0
            ? `${alertsSent} ${alertsSent === 1 ? "donor has" : "donors have"} been alerted so far.`
            : "No donors have been alerted yet."}
        </p>
        <ul className="mt-6 space-y-3">
          {ALERT_RINGS_KM.map((km, index) => {
            const ring = rings.find((r) => r.ring_km === km);
            const live = ring ? ring.finished_at === null : false;
            const done = ring ? ring.finished_at !== null : false;
            return (
              <li key={km} className="glass rounded-md px-5 py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-base font-bold text-ink-900">
                    Ring {ring?.ring_index ?? index + 1} · within {km} km
                  </span>
                  <span
                    className={`rounded-md px-3 py-1 text-sm font-bold ${live
                        ? "bg-blood-50 text-blood-700 border border-blood-200"
                        : done
                          ? "bg-green-50 text-green-900 border border-green-200"
                          : "bg-ink-100 text-ink-600 border border-ink-200"
                      }`}
                  >
                    {live ? "Live now" : done ? "Completed" : "Not started"}
                  </span>
                </div>
                {ring && (
                  <p className="mt-1 text-sm text-ink-600">
                    {ring.alerts_sent} {ring.alerts_sent === 1 ? "donor" : "donors"} alerted
                    {live ? `, renewing every ${ALERT_WINDOW_MINUTES} minutes` : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {latestRing !== null && latestRing.finished_at !== null && (
          <p className="mt-4 text-base text-ink-600">
            {latestRing.outcome === "accepted"
              ? "The alert process ended because a donor accepted."
              : latestRing.outcome === "rings_exhausted"
                ? "The alert process ended after the widest ring completed."
                : "The alert process ended when the request closed."}
          </p>
        )}

        <h2 className="mt-12 text-2xl font-extrabold tracking-tight text-ink-900">
          Request details
        </h2>
        <Card className="mt-6">
          <CardBody className="pt-6">
            <dl className="grid gap-6 sm:grid-cols-2">
              <Detail label="Blood group" value={request.blood_group} />
              <Detail
                label="Component"
                value={BLOOD_COMPONENT_LABELS[request.blood_component]}
              />
              <Detail
                label="Units"
                value={`${request.units} ${request.units === 1 ? "unit" : "units"}`}
              />
              <Detail label="Urgency" value={URGENCY_LABELS[request.urgency]} />
              <Detail label="Hospital" value={request.hospital_name} />
              <Detail label="Locality" value={request.hospital_locality} />
              <Detail label="Required by" value={formatDateTime(request.required_by)} />
              <Detail label="Contact name" value={request.contact_name} />
              <Detail
                label="Contact phone"
                value={
                  <a href={`tel:${request.contact_phone}`} className="underline">
                    {request.contact_phone}
                  </a>
                }
              />
              <Detail
                label="Hospital map pin"
                value={
                  request.hospital_latitude !== null && request.hospital_longitude !== null
                    ? "Approximate hospital area stored (~1 km)"
                    : "None — donors are matched by locality text"
                }
              />
            </dl>
            {request.note && (
              <p className="mt-6 rounded-md bg-ink-50 px-4 py-3 text-base text-ink-800">
                {request.note}
              </p>
            )}
          </CardBody>
        </Card>

        <div className="mt-8 flex flex-wrap gap-4">
          <ButtonLink href="/dashboard/requester" variant="secondary">
            Back to my requests
          </ButtonLink>
          {isActive && (
            <ButtonLink href={`/requests/${request.id}/matches`} variant="secondary">
              See matching donors
            </ButtonLink>
          )}
          {(ringsExhausted || closedCopy !== null) && (
            <ButtonLink href="/request-blood">Create a new request</ButtonLink>
          )}
        </div>

        <Alert variant="info" title="Privacy, by design" className="mt-8">
          Your phone number was never shown to anyone who was merely alerted — they saw the
          hospital area and a rough distance only. Contact details travel in one direction
          only, between you and a donor who accepted, and only for the response window.
          RaktSetu coordinates; the blood bank screens and decides.
        </Alert>

        {/* Reporting is deliberately last, visually quiet, and available on
            closed requests too: a request that turned out to be fake is still
            worth reporting after it ends. It never changes this request's
            status — a report only ever starts a moderation record. */}
        <Card className="mt-8">
          <CardBody className="pt-6">
            <details className="group">
              <summary className="cursor-pointer text-base font-semibold text-ink-900 marker:text-ink-400">
                Something wrong with this request?
              </summary>
              <p className="mt-2 max-w-2xl text-base text-ink-600">
                Tell an administrator if the blood group, units, hospital or urgency look
                wrong, or if this request is no longer needed. Reporting never cancels or
                hides a request, and you can report it once.
              </p>
              <div className="mt-4 max-w-2xl">
                <RequestReportForm
                  requestId={request.id}
                  alreadyReported={alreadyReported}
                />
              </div>
            </details>
          </CardBody>
        </Card>
      </Section>
    </>
  );
}
