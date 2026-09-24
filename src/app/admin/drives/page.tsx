import Link from "next/link";

import { requireRolePage } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/States";
import { AdminDriveForm } from "@/components/admin/AdminDriveForm";
import { DRIVE_STATUS_LABELS, DRIVE_STATUS_STYLES } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import type { CampusDrive } from "@/types";

export const metadata = { title: "Blood drives — admin" };

export const dynamic = "force-dynamic";

/**
 * Admin management of campus blood drives — list every drive (including
 * unpublished drafts) and create a new one.
 *
 * This is the EXISTING admin console, not a second dashboard. Editing a drive,
 * publishing it, checking donors in and recording donations all live on the
 * drive's own admin page.
 */
export default async function AdminDrivesPage() {
  await requireRolePage("admin");
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("campus_blood_drives")
    .select(
      "id, title, organizer, drive_date, starts_at, ends_at, venue, locality, description, target_units, status, published, reminder_sent_at, created_at, updated_at"
    )
    .order("drive_date", { ascending: false })
    .limit(100);

  const drives = (data as CampusDrive[] | null) ?? [];
  const nowMs = Date.now();
  const open = drives.filter(
    (d) => d.status === "upcoming" || new Date(d.starts_at).getTime() >= nowMs
  );
  const past = drives.filter(
    (d) => !(d.status === "upcoming" || new Date(d.starts_at).getTime() >= nowMs)
  );

  return (
    <>
      <PageHeader
        eyebrow="Admin · Blood drives"
        title="Campus blood drives"
        description="Planned, scheduled donation camps. Separate from emergency blood requests — a drive never creates or changes a request."
      />
      <Section>
        <div className="space-y-10">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
              Create a drive
            </h2>
            <p className="mt-2 max-w-2xl text-base text-ink-600">
              A new drive is created as a draft. Publish it when the schedule is
              firm — donors cannot see or register for a draft.
            </p>
            <div className="mt-6 rounded-lg border border-ink-200 bg-white p-6 shadow-sm sm:p-8">
              <AdminDriveForm />
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
              Upcoming and recent ({open.length})
            </h2>
            {drives.length === 0 ? (
              <div className="mt-6">
                <EmptyState
                  title="No drives yet"
                  description="Create the first campus blood drive above. It stays a draft until you publish it."
                />
              </div>
            ) : (
              <div className="mt-6 space-y-6">
                {[...open, ...past].map((d) => (
                  <Card key={d.id}>
                    <CardBody className="pt-6">
                      <div className="flex flex-wrap items-center gap-3">
                        <span
                          className={`rounded-md px-3 py-1 text-sm font-bold ${DRIVE_STATUS_STYLES[d.status] ?? "bg-ink-100 text-ink-600"}`}
                        >
                          {DRIVE_STATUS_LABELS[d.status] ?? d.status}
                        </span>
                        <span
                          className={`rounded-md px-3 py-1 text-sm font-bold ${d.published ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900"}`}
                        >
                          {d.published ? "Published" : "Draft"}
                        </span>
                      </div>
                      <h3 className="mt-3 text-xl font-extrabold tracking-tight text-ink-900">
                        {d.title}
                      </h3>
                      <p className="mt-1 text-base text-ink-600">
                        {d.organizer} · {d.venue}, {d.locality}
                      </p>
                      <p className="mt-1 text-sm text-ink-600">
                        {formatDateTime(d.starts_at)} – {formatDateTime(d.ends_at)}
                      </p>
                      <div className="mt-4">
                        <ButtonLink href={`/admin/drives/${d.id}`} variant="secondary">
                          Manage drive
                        </ButtonLink>
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <Alert variant="info" title="Recording a donation">
            A drive donation is written to the same donation ledger as an
            emergency donation, so the donor&apos;s availability interval starts
            automatically. It records that blood was collected — it is never a
            claim that the donor was medically eligible to give. The blood bank
            makes that decision.
          </Alert>

          <div>
            <Link
              href="/admin"
              className="text-base font-semibold text-blood-700 underline"
            >
              Back to admin overview
            </Link>
          </div>
        </div>
      </Section>
    </>
  );
}
