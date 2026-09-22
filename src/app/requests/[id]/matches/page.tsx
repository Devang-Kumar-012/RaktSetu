import { notFound, redirect } from "next/navigation";

import { getSessionInfo } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMatchResult, MATCH_RINGS_KM } from "@/lib/matching";
import { MatchPanel } from "@/components/requests/MatchPanel";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { RequestActions } from "@/components/requests/RequestActions";
import { formatDateTime } from "@/lib/utils";
import {
  BLOOD_COMPONENT_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_STYLES,
  URGENCY_LABELS,
} from "@/lib/constants";
import type { BloodRequest } from "@/types";

export const metadata = { title: "Request matches" };

function isUuid(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

/**
 * Requester-owned matching view for one ACTIVE blood request.
 * Server-rendered: the browser never touches matching criteria, and
 * donors are only ever the safe fields returned from the database function.
 */
export default async function RequestMatchesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const session = await getSessionInfo();
  if (!session.configured || !session.user) redirect(`/login?next=/requests/${id}/matches`);
  if (!session.profile || session.profile.role !== "requester") redirect("/dashboard");

  const supabase = await createSupabaseServerClient();
  const { data: request } = await supabase
    .from("blood_requests")
    .select("*")
    .eq("id", id)
    .eq("requester_id", session.user.id)
    .maybeSingle();

  if (!request) notFound();
  const bloodRequest = request as BloodRequest;

  const match = await getMatchResult(id);

  return (
    <>
      <PageHeader
        eyebrow="Matches"
        title={`${bloodRequest.blood_group} · ${bloodRequest.hospital_name}`}
        description={`${BLOOD_COMPONENT_LABELS[bloodRequest.blood_component]} · ${bloodRequest.units} ${bloodRequest.units === 1 ? "unit" : "units"} · ${bloodRequest.hospital_locality}`}
      />

      <Section className="max-w-3xl">
        <Card>
          <CardBody className="pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`rounded-md px-3 py-1 text-sm font-bold ${REQUEST_STATUS_STYLES[bloodRequest.status]}`}
              >
                {REQUEST_STATUS_LABELS[bloodRequest.status]}
              </span>
              <span className="text-base font-semibold text-ink-900">
                {URGENCY_LABELS[bloodRequest.urgency]} · needed by{" "}
                {formatDateTime(bloodRequest.required_by)}
              </span>
            </div>
            {bloodRequest.status === "active" && (
              <RequestActions requestId={bloodRequest.id} />
            )}
          </CardBody>
        </Card>

        <h2 className="mt-12 text-2xl font-extrabold tracking-tight text-ink-900">
          Matching donors
        </h2>
        <p className="mt-2 text-base text-ink-600">
          Checked within {MATCH_RINGS_KM.join(" km, ")} km of {bloodRequest.hospital_locality}.
          Distances are rough estimates, and matching pauses while your request is not
          active. Alerts are not sent yet — this screen shows who would respond first.
        </p>

        <div className="mt-6">
          <MatchPanel match={match} />
        </div>

        <Alert variant="info" title="Privacy, by design" className="mt-8">
          Donors are listed by blood group, area, and rough distance only. Phone numbers
          are never shown here — a number would be shared with you only after a donor
          accepts a future request alert, and that is not built yet. The blood bank
          always has the final word on eligibility.
        </Alert>

        <div className="mt-8 flex flex-wrap gap-4">
          <ButtonLink href="/dashboard/requester" variant="secondary">
            Back to my requests
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
