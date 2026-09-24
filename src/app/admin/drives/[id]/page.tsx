import { notFound } from "next/navigation";

import { requireRolePage } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { AdminDriveForm } from "@/components/admin/AdminDriveForm";
import { AdminDriveVisibility } from "@/components/admin/AdminDriveVisibility";
import { AdminDriveRoster } from "@/components/admin/AdminDriveRoster";
import { DRIVE_STATUS_LABELS, DRIVE_STATUS_STYLES } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import type { CampusDrive, CampusDriveStats, DriveRegistration } from "@/types";

export const metadata = { title: "Manage blood drive — admin" };

export const dynamic = "force-dynamic";

function isUuid(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

/**
 * Admin management of ONE campus blood drive: edit it, publish or hide it, work
 * the roster, and record donations.
 *
 * Operational figures come from campus_drive_stats(), a SECURITY DEFINER
 * function that is admin/volunteer-gated and returns COUNTS ONLY. The roster is
 * a list of donor uuids and states — no phone, e-mail, locality or coordinates
 * are ever selected, so checking people in on the day exposes no private data.
 */
export default async function AdminDriveDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { profile } = await requireRolePage("admin");
  const supabase = await createSupabaseServerClient();

  const { data: driveRow } = await supabase
    .from("campus_blood_drives")
    .select(
      "id, title, organizer, drive_date, starts_at, ends_at, venue, locality, description, target_units, status, published, reminder_sent_at, created_at, updated_at"
    )
    .eq("id", id)
    .maybeSingle();
  const drive = driveRow as CampusDrive | null;
  if (!drive) notFound();

  const [statsResult, rosterResult, donationResult] = await Promise.all([
    supabase.rpc("campus_drive_stats", { p_drive_id: drive.id }),
    supabase
      .from("campus_drive_registrations")
      .select("id, drive_id, donor_id, status, note, registered_at, updated_at")
      .order("registered_at", { ascending: true })
      .limit(200),
    supabase
      .from("donation_history")
      .select("donor_id, units, blood_component, donated_on")
      .eq("drive_id", drive.id),
  ]);

  const stats = ((statsResult.data as CampusDriveStats[] | null) ?? [])[0] ?? null;
  const registrations = (rosterResult.data as DriveRegistration[] | null) ?? [];
  const donationsByDonor = new Map<
    string,
    { units: number; component: string | null; donated_on: string }
  >();
  for (const d of (donationResult.data ?? []) as {
    donor_id: string;
    units: number;
    blood_component: string | null;
    donated_on: string;
  }[]) {
    donationsByDonor.set(d.donor_id, {
      units: d.units,
      component: d.blood_component,
      donated_on: d.donated_on,
    });
  }

  const driveClosed = drive.status === "completed" || drive.status === "cancelled";
  const interest = stats
    ? stats.registered + stats.checked_in + stats.participated
    : registrations.filter((r) => r.status !== "cancelled").length;
  const groupEntries = Object.entries(stats?.group_breakdown ?? {}).sort(
    (a, b) => b[1] - a[1]
  );

  return (
    <>
      <PageHeader
        eyebrow="Admin · Blood drive"
        title={drive.title}
        description={`${drive.organizer} · ${formatDateTime(drive.starts_at)}`}
      />
      <Section>
        <div className="space-y-10">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-md px-3 py-1 text-sm font-bold ${DRIVE_STATUS_STYLES[drive.status] ?? "bg-ink-100 text-ink-600"}`}
            >
              {DRIVE_STATUS_LABELS[drive.status] ?? drive.status}
            </span>
            <span
              className={`rounded-md px-3 py-1 text-sm font-bold ${drive.published ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900"}`}
            >
              {drive.published ? "Published" : "Draft — not visible to donors"}
            </span>
          </div>

          {/* Aggregate operational figures — counts only, never a roster. */}
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
              At a glance
            </h2>
            <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Registered donors", value: interest },
                { label: "Checked in", value: stats?.checked_in ?? 0 },
                { label: "Took part", value: stats?.participated ?? 0 },
                { label: "Units collected", value: stats?.units_collected ?? 0 },
              ].map((s) => (
                <div key={s.label} className="glass rounded-lg p-5">
                  <dt className="text-sm font-bold uppercase tracking-widest text-ink-500">
                    {s.label}
                  </dt>
                  <dd className="mt-1 text-3xl font-extrabold text-ink-900">{s.value}</dd>
                </div>
              ))}
            </dl>

            {stats && stats.target_units !== null && (
              <div className="mt-6 rounded-lg border border-ink-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-bold text-ink-900">Target progress</h3>
                  <p className="text-sm font-semibold text-ink-600">
                    {stats.units_collected} of {stats.target_units} units
                  </p>
                </div>
                <div
                  className="mt-3 h-3 w-full overflow-hidden rounded-full bg-ink-100"
                  role="img"
                  aria-label={`${stats.units_collected} of ${stats.target_units} target units collected`}
                >
                  <div
                    className="h-full rounded-full bg-blood-700"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (stats.units_collected / Math.max(1, stats.target_units)) * 100
                        )
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {groupEntries.length > 0 && (
              <div className="mt-6 rounded-lg border border-ink-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-bold text-ink-900">
                  Registered donors by blood group
                </h3>
                <p className="mt-1 text-sm text-ink-600">
                  Aggregate counts, for planning stock. No individual donor is
                  identified here.
                </p>
                <ul className="mt-4 flex flex-wrap gap-3">
                  {groupEntries.map(([group, count]) => (
                    <li
                      key={group}
                      className="rounded-md border border-ink-200 bg-ink-50 px-4 py-2 text-base text-ink-900"
                    >
                      <span className="font-bold">{group}</span>{" "}
                      <span className="text-ink-600">
                        {count} {count === 1 ? "donor" : "donors"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
              Visibility
            </h2>
            <p className="mt-2 max-w-2xl text-base text-ink-600">
              Unpublishing hides the drive from donors. The roster and every
              recorded donation are kept — a donor&apos;s donation history must
              survive a drive being taken off the site.
            </p>
            <div className="mt-6 max-w-md">
              <AdminDriveVisibility drive={drive} />
            </div>
          </div>


          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">Roster</h2>
            <p className="mt-2 max-w-2xl text-base text-ink-600">
              {profile.role === "admin"
                ? "Check donors in and record the donations collected. Recording a donation starts that donor's availability interval."
                : "Check donors in as they arrive."}
            </p>
            <div className="mt-6">
              <AdminDriveRoster
                driveId={drive.id}
                registrations={registrations}
                donationsByDonor={donationsByDonor}
                canRecordDonations={profile.role === "admin"}
                driveClosed={driveClosed}
              />
            </div>
          </div>

          {driveClosed && (
            <Alert variant="info" title="This drive is closed">
              {drive.status === "cancelled"
                ? "It was cancelled, so the roster is read-only and every registered donor was told."
                : "It was completed, so the roster is read-only. Donations recorded here still count towards the donor's donation history."}
            </Alert>
          )}

          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
              Edit drive
            </h2>
            <p className="mt-2 max-w-2xl text-base text-ink-600">
              Changing the date, time, venue or status tells every registered
              donor — once per change, never repeatedly.
            </p>
            <div className="mt-6 rounded-lg border border-ink-200 bg-white p-6 shadow-sm sm:p-8">
              <AdminDriveForm drive={drive} />
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <ButtonLink href="/admin/drives" variant="secondary">
              All blood drives
            </ButtonLink>
            {drive.published && (
              <ButtonLink href={`/drives/${drive.id}`} variant="secondary">
                View donor-facing page
              </ButtonLink>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}

