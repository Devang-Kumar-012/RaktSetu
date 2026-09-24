import { notFound, redirect } from "next/navigation";

import { requireRolePage, getSessionInfo } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import {
  BLOOD_COMPONENT_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_STYLES,
  URGENCY_LABELS,
} from "@/lib/constants";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { LiveRefresh } from "@/components/notifications/LiveRefresh";
import { RequestReportForm } from "@/components/requests/RequestReportForm";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { VolunteerRequestActions } from "@/components/volunteer/VolunteerRequestActions";
import type { VolunteerRequestView } from "@/types";

export const metadata = { title: "Request details — volunteer" };

function isUuid(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

/**
 * Volunteer view of one request. Data comes only from
 * volunteer_request_detail() — role-checked in the database and limited to
 * safe fields. No requester contact details, no donor private data.
 */
export default async function VolunteerRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  await requireRolePage("volunteer");

  const session = await getSessionInfo();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("volunteer_request_detail", {
    p_request_id: id,
  });

  if (error) {
    console.error("volunteer_request_detail failed:", error.message);
    notFound();
  }

  const request = (data as VolunteerRequestView[] | null)?.[0];
  if (!request) notFound();

  // Own-row RLS: this can only ever reveal whether THIS volunteer already
  // filed a report on this request, never anyone else's reporting activity.
  const { data: ownReports } = await supabase
    .from("request_reports")
    .select("id")
    .eq("request_id", request.id)
    .eq("reporter_id", session.user?.id ?? "")
    .limit(1);
  const alreadyReported = (ownReports ?? []).length > 0;

  return (
    <>
      {/* The assisted request can close underneath the volunteer mid-view; the
          shared live channel keeps the coordination panel from going stale. */}
      <LiveRefresh />
      <PageHeader
        eyebrow="Volunteer · Request details"
        title={`${request.blood_group} · ${request.hospital_name}`}
        description={`${BLOOD_COMPONENT_LABELS[request.blood_component]} · ${request.units} ${request.units === 1 ? "unit" : "units"} · ${request.hospital_locality}`}
      />

      <Section className="max-w-3xl">
        <Card>
          <CardBody className="pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-2xl font-extrabold text-blood-700">
                {request.blood_group}
              </span>
              <span
                className={`rounded-md px-3 py-1 text-sm font-bold ${REQUEST_STATUS_STYLES[request.status]}`}
              >
                {REQUEST_STATUS_LABELS[request.status]}
              </span>
              {request.donor_accepted && (
                <span className="rounded-md bg-green-50 px-3 py-1 text-sm font-bold text-green-900 border border-green-200">
                  Donor accepted
                </span>
              )}
              {request.me_assisting && (
                <span className="rounded-md bg-blue-50 px-3 py-1 text-sm font-bold text-blue-900 border border-blue-200">
                  You are assisting
                </span>
              )}
            </div>

            <p className="mt-4 text-lg font-bold text-ink-900">
              {request.hospital_name}
              <span className="font-medium text-ink-600"> — {request.hospital_locality}</span>
            </p>
            <p className="mt-1 text-base text-ink-600">
              {URGENCY_LABELS[request.urgency]} · Required by{" "}
              {formatDateTime(request.required_by)}
            </p>
            <p className="mt-2 text-base text-ink-600">
              {request.volunteers_assisting === 0
                ? "No volunteers assisting yet."
                : `${request.volunteers_assisting} volunteer${request.volunteers_assisting === 1 ? "" : "s"} assisting.`}
            </p>
            {request.note && (
              <p className="mt-3 rounded-md bg-ink-50 px-4 py-3 text-base text-ink-700">
                Note from the requester: {request.note}
              </p>
            )}

            {request.status === "active" ? (
              <VolunteerRequestActions
                requestId={request.id}
                meAssisting={request.me_assisting}
                currentNote={null}
              />
            ) : (
              <Alert variant="info" title="This request is no longer active" className="mt-6">
                Only active requests can be assisted. This one has been fulfilled,
                expired, or cancelled.
              </Alert>
            )}
          </CardBody>
        </Card>

        <Alert variant="info" title="What a volunteer can and cannot do" className="mt-8">
          You can view active requests, record that you are helping, and keep a private
          note. Volunteers cannot mark requests fulfilled (that is the requester&apos;s
          call), approve donors, change blood groups, or see anyone&apos;s private
          contact details.
        </Alert>

        {request.status === "active" && (
          <Card className="mt-8">
            <CardBody className="pt-6">
              <h3 className="text-lg font-bold text-ink-900">Something wrong with this request?</h3>
              <p className="mt-1 text-base text-ink-600">
                Report a fake, incorrect, or no-longer-needed request for admin review.
                Reporting never cancels or hides the request, and you can report a
                request once.
              </p>
              <div className="mt-4 max-w-2xl">
                <RequestReportForm
                  requestId={request.id}
                  alreadyReported={alreadyReported}
                />
              </div>
            </CardBody>
          </Card>
        )}

        <div className="mt-8 flex flex-wrap gap-4">
          <ButtonLink href="/volunteer" variant="secondary">
            Back to volunteer dashboard
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
