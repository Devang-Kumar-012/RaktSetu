import { Card, CardBody } from "@/components/ui/Card";
import { DRIVE_REGISTRATION_STATUS_LABELS, DRIVE_STATUS_LABELS, DRIVE_STATUS_STYLES } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import type { CampusDrive, DriveRegistrationStatus } from "@/types";

/**
 * One campus blood drive, as donors see it.
 *
 * Shows only public event information — who, when, where, what to expect. It
 * deliberately renders NO roster, no donor names, no phone numbers and no
 * locations: another donor's participation is not a donor's business, and
 * registrations are own-row under RLS regardless of what this renders.
 */
export function DriveCard({
  drive,
  registrationStatus = null,
}: {
  drive: CampusDrive;
  /** The VIEWING donor's own state, or null when they are not registered. */
  registrationStatus?: DriveRegistrationStatus | null;
}) {
  return (
    <Card className="h-full">
      <CardBody className="flex h-full flex-col pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-md px-3 py-1 text-sm font-bold ${DRIVE_STATUS_STYLES[drive.status] ?? "bg-ink-100 text-ink-600"}`}
          >
            {DRIVE_STATUS_LABELS[drive.status] ?? drive.status}
          </span>
          {registrationStatus && (
            <span className="rounded-md bg-blood-50 px-3 py-1 text-sm font-bold text-blood-700">
              You: {DRIVE_REGISTRATION_STATUS_LABELS[registrationStatus]}
            </span>
          )}
        </div>

        <h3 className="mt-4 text-2xl font-extrabold tracking-tight text-ink-900">
          {drive.title}
        </h3>
        <p className="mt-1 text-base font-semibold text-ink-600">{drive.organizer}</p>

        <dl className="mt-5 space-y-2 text-base text-ink-800">
          <div className="flex gap-2">
            <dt className="font-semibold text-ink-500">When</dt>
            <dd>{formatDateTime(drive.starts_at)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-semibold text-ink-500">Where</dt>
            <dd>
              {drive.venue}, {drive.locality}
            </dd>
          </div>
          {drive.target_units !== null && (
            <div className="flex gap-2">
              <dt className="font-semibold text-ink-500">Target</dt>
              <dd>{drive.target_units} units collected</dd>
            </div>
          )}
        </dl>

        {drive.description && (
          <p className="mt-4 text-base text-ink-700">{drive.description}</p>
        )}

        {/* Kept last so the card always ends in a clear, tappable action. */}
        <div className="mt-auto pt-6">
          <a
            href={`/drives/${drive.id}`}
            className="inline-block rounded-md bg-blood-700 px-4 py-2 text-base font-semibold text-white hover:bg-blood-800"
          >
            View drive
          </a>
        </div>
      </CardBody>
    </Card>
  );
}
