import { notFound } from "next/navigation";

import { getSessionInfo } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { DriveRegistrationPanel } from "@/components/drives/DriveRegistrationPanel";
import { DRIVE_STATUS_LABELS, DRIVE_STATUS_STYLES } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import type { CampusDrive, DriveRegistration } from "@/types";

export const metadata = { title: "Campus blood drive" };

export const dynamic = "force-dynamic";

function isUuid(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

/**
 * One campus blood drive, as donors see it.
 *
 * Visibility is decided by the database: the RLS SELECT policy returns a drive
 * only when it is published (or the viewer is an admin), so an unpublished draft
 * is indistinguishable from a missing one here.
 *
 * Only the VIEWER'S OWN registration is ever read. Other donors' rows are not
 * queried at all, and no aggregate is rendered here — on a small campus drive
 * even an aggregate could identify people.
 */
export default async function DriveDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const session = await getSessionInfo();
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("campus_blood_drives")
    .select(
      "id, title, organizer, drive_date, starts_at, ends_at, venue, locality, description, target_units, status, published, reminder_sent_at, created_at, updated_at"
    )
    .eq("id", id)
    .maybeSingle();

  // RLS already refused an unpublished drive for a non-admin; this keeps the
  // page honest if the row is missing for any other reason.
  const drive = data as CampusDrive | null;
  if (!drive) notFound();

  const isDonor = session.profile?.role === "donor" && session.profile.status === "active";
  let mine: DriveRegistration["status"] | null = null;
  if (isDonor && session.user) {
    // Own-row RLS: this can only ever return the caller's own registration.
    const { data: own } = await supabase
      .from("campus_drive_registrations")
      .select("status")
      .eq("drive_id", drive.id)
      .eq("donor_id", session.user.id)
      .maybeSingle();
    mine = (own as { status: DriveRegistration["status"] } | null)?.status ?? null;
  }

  const nowMs = Date.now();
  const openForRegistration =
    drive.published &&
    drive.status === "upcoming" &&
    new Date(drive.starts_at).getTime() > nowMs;

  return (
    <>
      <PageHeader
        eyebrow="Campus blood drive"
        title={drive.title}
        description={`${drive.organizer} · ${formatDateTime(drive.starts_at)}`}
      />
      <Section className="max-w-3xl">
        <div className="space-y-8">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-md px-3 py-1 text-sm font-bold ${DRIVE_STATUS_STYLES[drive.status] ?? "bg-ink-100 text-ink-600"}`}
            >
              {DRIVE_STATUS_LABELS[drive.status] ?? drive.status}
            </span>
            {drive.status === "cancelled" && (
              <span className="text-sm font-semibold text-red-700">
                This drive was cancelled by the organisers.
              </span>
            )}
            {drive.status === "completed" && (
              <span className="text-sm font-semibold text-ink-600">
                This drive has finished. Thank you to everyone who took part.
              </span>
            )}
          </div>

          {/* Facts first, action second — a drive page must never crowd out the
              emergency route, which stays one tap below. */}
          <Card glass>
            <CardBody className="pt-6">
              <h2 className="text-xl font-bold tracking-tight text-ink-900">
                Drive details
              </h2>
              <dl className="mt-4 divide-y divide-ink-100">
                <div className="flex flex-wrap justify-between gap-2 py-3">
                  <dt className="text-base text-ink-600">Organised by</dt>
                  <dd className="text-base font-semibold text-ink-900">{drive.organizer}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2 py-3">
                  <dt className="text-base text-ink-600">Date</dt>
                  <dd className="text-base font-semibold text-ink-900">{drive.drive_date}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2 py-3">
                  <dt className="text-base text-ink-600">Time</dt>
                  <dd className="text-base font-semibold text-ink-900">
                    {formatDateTime(drive.starts_at)} – {formatDateTime(drive.ends_at)}
                  </dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2 py-3">
                  <dt className="text-base text-ink-600">Venue</dt>
                  <dd className="text-base font-semibold text-ink-900">
                    {drive.venue}, {drive.locality}
                  </dd>
                </div>
                {drive.target_units !== null && (
                  <div className="flex flex-wrap justify-between gap-2 py-3">
                    <dt className="text-base text-ink-600">Target</dt>
                    <dd className="text-base font-semibold text-ink-900">
                      {drive.target_units} units collected
                    </dd>
                  </div>
                )}
              </dl>
              {drive.description && (
                <p className="mt-4 rounded-md bg-ink-50 px-4 py-3 text-base text-ink-800">
                  {drive.description}
                </p>
              )}
            </CardBody>
          </Card>

          <Card glass>
            <CardBody className="pt-6">
              <h2 className="text-xl font-bold tracking-tight text-ink-900">
                Your registration
              </h2>
              <p className="mt-2 text-base text-ink-600">
                Your registration is private. Nobody else can see whether you
                signed up, and the organisers do not receive your phone number.
              </p>
              <div className="mt-6 max-w-xl">
                <DriveRegistrationPanel
                  driveId={drive.id}
                  status={mine}
                  openForRegistration={openForRegistration}
                  isDonor={isDonor}
                />
              </div>
            </CardBody>
          </Card>

          <Alert variant="info" title="Before you come">
            Carry a photo ID. Eat well and drink water beforehand. The blood bank
            screens every donor on the day — RaktSetu never decides who is
            medically eligible to give.
          </Alert>

          <div className="flex flex-wrap gap-4">
            <ButtonLink href="/drives" variant="secondary">
              All campus drives
            </ButtonLink>
            <ButtonLink href="/request-blood">I need blood urgently</ButtonLink>
          </div>
        </div>
      </Section>
    </>
  );
}

