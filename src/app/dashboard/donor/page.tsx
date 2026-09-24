import { requireRolePage } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { DonorAlertCard } from "@/components/alerts/DonorAlertCard";
import { AvailabilityControl } from "@/components/donor/AvailabilityControl";
import { DonorStatusBadges } from "@/components/donor/DonorStatusBadges";
import { DriveCard } from "@/components/drives/DriveCard";
import { RingStatusStrip } from "@/components/donor/RingStatusStrip";
import { isAlertActionable } from "@/lib/alert-rings";
import type { AlertState } from "@/lib/alert-rings";
import {
  ALERT_RINGS_KM,
  ALERT_WINDOW_MINUTES,
  BLOOD_COMPONENT_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_STYLES,
} from "@/lib/constants";
import { getDonorEligibility } from "@/lib/eligibility";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/utils";
import type {
  CampusDrive,
  DonorAlertRow,
  DonorDonationRow,
  DonorProfile,
  DriveRegistration,
} from "@/types";

export const metadata = { title: "Donor dashboard" };

// Session-gated: render per request so the role check is never baked into a
// static prerender (which would redirect forever in production).
export const dynamic = "force-dynamic";

export default async function DonorDashboardPage() {
  const { user, profile } = await requireRolePage("donor");

  const supabase = await createSupabaseServerClient();
  const { data: donor } = await supabase
    .from("donor_profiles")
    .select(
      "user_id, blood_group, locality, last_donation_date, phone, latitude, longitude, availability, donation_count, created_at, updated_at"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  const donorProfile = (donor as DonorProfile) ?? null;
  const firstName = profile.full_name.trim().split(" ")[0];

  // Emergency alert queue (ring engine — migration 0011). Actionability is
  // decided here with the SERVER clock; the database re-checks everything
  // atomically when the donor submits accept/decline. The queue splits into
  // still-actionable alerts, this donor's acceptances, and everything already
  // closed/declined (hidden so a past alert never resurfaces as new).
  const { data: alertRows } = await supabase.rpc("donor_active_alerts", {
    p_limit: 20,
  });
  const nowMs = Date.now();
  const alertCards = ((alertRows as DonorAlertRow[] | null) ?? []).map((row) => {
    const actionable = isAlertActionable(
      {
        id: row.alert_id,
        requestId: row.request_id,
        donorId: user.id,
        ringKm: row.ring_km,
        status: row.status,
        dueAt: new Date(row.due_at).getTime(),
        response: row.response,
      } satisfies AlertState,
      nowMs
    );
    return {
      row,
      actionable,
      minutesLeft: actionable
        ? Math.max(
          0,
          Math.ceil((new Date(row.due_at).getTime() - nowMs) / 60_000)
        )
        : null,
    };
  });
  const openCards = alertCards.filter((c) => c.actionable);
  const acceptedCards = alertCards.filter((c) => c.row.response === "accepted");
  const closedCount =
    alertCards.length - openCards.length - acceptedCards.length;

  // Own donation history (migration 0012 — SECURITY DEFINER, own rows only).
  const { data: historyRows } = await supabase.rpc("donor_donation_history", {
    p_limit: 20,
  });
  const donationHistory = (historyRows as DonorDonationRow[] | null) ?? [];
  const eligibility = getDonorEligibility(donorProfile);

  // Campus drives (migration 0015). Published drives are readable by any
  // signed-in user; the viewer's OWN registrations are what RLS will return,
  // so this can never show anyone else's participation.
  const [driveResult, ownDrivesResult] = await Promise.all([
    supabase
      .from("campus_blood_drives")
      .select(
        "id, title, organizer, drive_date, starts_at, ends_at, venue, locality, description, target_units, status, published, reminder_sent_at, created_at, updated_at"
      )
      .eq("published", true)
      .in("status", ["upcoming", "ongoing"])
      .order("starts_at", { ascending: true })
      .limit(4),
    supabase
      .from("campus_drive_registrations")
      .select("drive_id, status")
      .eq("donor_id", user.id),
  ]);
  const upcomingDrives = (driveResult.data as CampusDrive[] | null) ?? [];
  const myDriveStatuses = new Map<string, DriveRegistration["status"]>(
    ((ownDrivesResult.data ?? []) as { drive_id: string; status: DriveRegistration["status"] }[]).map(
      (r) => [r.drive_id, r.status]
    )
  );

  return (
    <>
      <PageHeader
        eyebrow="Donor dashboard"
        title={`Hi, ${firstName}`}
        description="Your availability and donation details — visible only to you and platform administrators."
      />

      <Section>
        {!donorProfile ? (
          <Alert variant="warning" title="Your donor profile is not set up yet">
            Add your blood group and locality so coordinators can find you when someone
            nearby needs blood.
            <div className="mt-4">
              <ButtonLink href="/profile/donor">Set up donor profile</ButtonLink>
            </div>
          </Alert>
        ) : (
          <>
            <DonorStatusBadges donor={donorProfile} />
            <div className="mt-6">
              <AvailabilityControl donor={donorProfile} />
            </div>
          </>
        )}

        {/* Campus drives (migration 0015) — deliberately a separate section
            from emergency alerts below. A planned drive is not an emergency,
            and nothing here changes matching or an alert. */}
        <h2 className="mt-12 text-2xl font-extrabold tracking-tight text-ink-900">
          Campus blood drives
        </h2>
        <p className="mt-2 max-w-3xl text-base text-ink-600">
          Planned donation camps run by colleges and organisations. Register your
          interest, then turn up — or skip one and wait for a nearby emergency
          alert instead. Registering for a drive does not affect your emergency
          availability.
        </p>
        <div className="mt-6">
          {upcomingDrives.length === 0 ? (
            <EmptyState
              title="No open drives right now"
              description="Campus drives appear here once an administrator publishes them. You will get an in-app notification when one is announced."
              action={
                <ButtonLink href="/drives" variant="secondary">
                  See all campus drives
                </ButtonLink>
              }
            />
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {upcomingDrives.slice(0, 4).map((drive) => (
                <DriveCard
                  key={drive.id}
                  drive={drive}
                  registrationStatus={myDriveStatuses.get(drive.id) ?? null}
                />
              ))}
            </div>
          )}
          <div className="mt-6">
            <ButtonLink href="/drives" variant="secondary">
              All campus blood drives
            </ButtonLink>
          </div>
        </div>

        <h2 className="mt-12 text-2xl font-extrabold tracking-tight text-ink-900">
          Emergency alerts
        </h2>
        <p className="mt-2 text-base text-ink-600">
          Matching donors are alerted in expanding rings —{" "}
          {ALERT_RINGS_KM.map((km) => `${km} km`).join(" → ")},{" "}
          {ALERT_WINDOW_MINUTES} minutes per ring — only while you are available
          and past the donation interval. Accepting shares the requester&apos;s
          contact with you; declining is respected permanently for that request.
        </p>

        <RingStatusStrip
          items={openCards.map(({ row, minutesLeft }) => ({
            ringKm: row.ring_km,
            minutesLeft: minutesLeft ?? 0,
            requestStatus: row.request_status,
          }))}
        />

        <div className="mt-6 space-y-6">
          {openCards.length > 0 ? (
            openCards.map(({ row, actionable, minutesLeft }) => (
              <DonorAlertCard
                key={row.alert_id}
                alert={row}
                actionable={actionable}
                minutesLeft={minutesLeft}
              />
            ))
          ) : acceptedCards.length > 0 ? (
            <p className="rounded-lg border border-dashed border-ink-200 bg-white px-5 py-6 text-center text-base text-ink-600">
              No open alerts right now — your accepted requests are just below.
            </p>
          ) : (
            <EmptyState
              title="No alerts right now"
              description="When a verified nearby request matches your blood group, it will appear here with accept and decline buttons."
            />
          )}
        </div>

        {acceptedCards.length > 0 && (
          <>
            <h2 className="mt-12 text-2xl font-extrabold tracking-tight text-ink-900">
              Your accepted requests
            </h2>
            <p className="mt-2 text-base text-ink-600">
              Coordination details for requests you committed to — screening at
              the blood bank always remains the final step.
            </p>
            <div className="mt-6 space-y-6">
              {acceptedCards.map(({ row }) => (
                <DonorAlertCard
                  key={row.alert_id}
                  alert={row}
                  actionable={false}
                />
              ))}
            </div>
          </>
        )}

        {closedCount > 0 && (
          <p className="mt-6 text-sm text-ink-400">
            {closedCount} earlier alert{closedCount === 1 ? "" : "s"} closed or
            declined.
          </p>
        )}

        <h2 className="mt-12 text-2xl font-extrabold tracking-tight text-ink-900">
          Donation history
        </h2>
        <p className="mt-2 text-base text-ink-600">
          Completed donations recorded by your coordinator
          {donorProfile && (
            <>
              {" · "}
              <strong className="text-ink-900">{donationHistory.length}</strong>{" "}
              shown,{" "}
              <strong className="text-ink-900">
                {donorProfile.donation_count}
              </strong>{" "}
              on record
            </>
          )}
          .
        </p>

        {donorProfile && (
          <p className="mt-3 text-base text-ink-600">
            <strong className="text-ink-900">
              {eligibility.status === "not_currently_eligible"
                ? `Next eligible: ${eligibility.nextEligibleLabel}`
                : eligibility.status === "available"
                  ? "You are eligible to match now"
                  : "Matching is paused while you are unavailable"}
            </strong>{" "}
            — an availability filter only. Final eligibility is always the
            blood bank&apos;s medical screening.
          </p>
        )}

        <div className="mt-6 space-y-4">
          {donationHistory.length === 0 ? (
            <EmptyState
              title="No donations recorded yet"
              description="Completed donations appear here once your coordinator records them — coordination records only, never medical data."
            />
          ) : (
            donationHistory.map((row) => (
              <div
                key={`${row.donation_date}-${row.request_id ?? row.drive_id ?? "none"}`}
                className="rounded-lg border border-ink-200 bg-white px-5 py-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-base font-bold text-ink-900">
                    {formatDate(row.donation_date)} ·{" "}
                    {row.blood_component
                      ? BLOOD_COMPONENT_LABELS[row.blood_component]
                      : "Donation"}{" "}
                    · {row.units} {row.units === 1 ? "unit" : "units"}
                  </p>
                  <span
                    className={cn(
                      "rounded-md border px-3 py-1 text-sm font-bold",
                      row.request_status
                        ? REQUEST_STATUS_STYLES[row.request_status]
                        : "border-ink-200 bg-ink-100 text-ink-600"
                    )}
                  >
                    {/* A campus drive is its own kind of occasion, not a blood
                        request — so it gets its own label rather than being
                        shown as "not linked to a request". */}
                    {row.request_status
                      ? REQUEST_STATUS_LABELS[row.request_status]
                      : row.drive_id
                        ? "Campus drive"
                        : "Not linked to a request"}
                  </span>
                </div>
                {row.hospital_name && (
                  <p className="mt-1 text-base text-ink-600">
                    {row.hospital_name}
                    {row.hospital_locality && ` — ${row.hospital_locality}`}
                  </p>
                )}
                {row.drive_title && row.drive_id && (
                  <p className="mt-1 text-base text-ink-600">
                    {row.drive_title} ·{" "}
                    <a href={`/drives/${row.drive_id}`} className="underline">
                      View drive
                    </a>
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </Section>
    </>
  );
}
