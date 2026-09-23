import { formatDateTime } from "@/lib/utils";
import {
  BLOOD_COMPONENT_LABELS,
  URGENCY_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_STYLES,
} from "@/lib/constants";
import { Card, CardBody } from "@/components/ui/Card";
import { ButtonLink } from "@/components/ui/Button";
import type { VolunteerRequestView } from "@/types";

/**
 * Safe summary card for one request on the volunteer dashboard.
 * Only fields from volunteer_active_requests() are rendered — no requester
 * contact details and no donor private data ever reach this component.
 */
export function VolunteerRequestCard({
  request,
  showAssistingBadge = true,
}: {
  request: VolunteerRequestView;
  showAssistingBadge?: boolean;
}) {
  return (
    <Card glass>
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
          {request.donor_accepted && (
            <span className="rounded-md bg-green-50 px-3 py-1 text-sm font-bold text-green-900 border border-green-200">
              Donor accepted
            </span>
          )}
          {showAssistingBadge && request.me_assisting && (
            <span className="rounded-md bg-blue-50 px-3 py-1 text-sm font-bold text-blue-900 border border-blue-200">
              You are assisting
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
        <p className="mt-2 text-sm text-ink-600">
          {request.volunteers_assisting === 0
            ? "No volunteers assisting yet."
            : `${request.volunteers_assisting} volunteer${request.volunteers_assisting === 1 ? "" : "s"} assisting.`}
        </p>

        <div className="mt-4">
          <ButtonLink href={`/volunteer/requests/${request.id}`} variant="secondary">
            {request.me_assisting ? "Open request" : "View & assist"}
          </ButtonLink>
        </div>
      </CardBody>
    </Card>
  );
}
