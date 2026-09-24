import { getSessionInfo } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { tickDriveReminders } from "@/lib/actions/drives";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { DriveCard } from "@/components/drives/DriveCard";
import type { CampusDrive, DriveRegistration } from "@/types";

export const metadata = { title: "Campus blood drives" };

// Session-gated and per-request: registration state is the viewer's own row,
// and a static prerender would bake that in.
export const dynamic = "force-dynamic";

/**
 * Donor-facing list of published campus blood drives.
 *
 * Shows ONLY published drives (the RLS SELECT policy enforces that even if this
 * query asked for more), and shows the viewer's OWN registration state only.
 * No roster, no other donor's details, no aggregate that could identify a
 * person in a small drive.
 *
 * Planned giving is a completely separate thing from emergency blood: nothing
 * here creates, alters or alerts on a blood request.
 */
export default async function DrivesPage() {
  const session = await getSessionInfo();
  const isDonor = session.profile?.role === "donor" && session.profile.status === "active";

  // Reminders are a one-shot, idempotent sweep. Calling it here means donors
  // still get their "coming up" notice when pg_cron is unavailable — the same
  // pattern the ring engine uses for its expiring nudge.
  if (isDonor) {
    await tickDriveReminders();
  }

  let drives: CampusDrive[] = [];
  const mine = new Map<string, DriveRegistration["status"]>();

  if (session.configured && session.user) {
    const supabase = await createSupabaseServerClient();

    const driveQuery = supabase
      .from("campus_blood_drives")
      .select(
        "id, title, organizer, drive_date, starts_at, ends_at, venue, locality, description, target_units, status, published, reminder_sent_at, created_at, updated_at"
      )
      .eq("published", true)
      .order("drive_date", { ascending: true })
      .limit(50);

    // Only a donor's own rows are ever readable here; this extra filter is a
    // second belt, not the boundary — RLS is.
    const ownQuery = isDonor
      ? supabase
        .from("campus_drive_registrations")
        .select("drive_id, status")
        .eq("donor_id", session.user.id)
      : Promise.resolve({
        data: [] as { drive_id: string; status: DriveRegistration["status"] }[],
      });

    const [driveResult, ownResult] = await Promise.all([driveQuery, ownQuery]);
    drives = (driveResult.data as CampusDrive[] | null) ?? [];
    for (const row of (ownResult.data ?? []) as {
      drive_id: string;
      status: DriveRegistration["status"];
    }[]) {
      mine.set(row.drive_id, row.status);
    }
  }

  const nowMs = Date.now();
  const stillRelevant = (d: CampusDrive) =>
    d.status === "upcoming" || d.status === "ongoing" || new Date(d.ends_at).getTime() >= nowMs;
  const open = drives.filter(stillRelevant);
  const past = drives.filter((d) => !stillRelevant(d));

  return (
    <>
      <PageHeader
        eyebrow="Campus blood drives"
        title="Planned blood drives"
        description="Organised, scheduled donation camps run by colleges and organisations. Register your interest, then turn up — this is separate from emergency blood requests."
      />
      <Section>
        {!session.configured ? (
          <Alert variant="warning" title="Supabase is not configured">
            Add your project URL and anon key to .env.local to see campus drives.
          </Alert>
        ) : (
          <div className="space-y-10">
            {/* One glass summary band, then ordinary surfaces below it. The
                rhythm (glass → normal → glass) is deliberate: glass marks the
                areas that matter, it does not become the whole page. */}
            <div className="glass rounded-lg p-6 sm:p-8">
              <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
                Campus blood drives
              </h2>
              <p className="mt-2 max-w-2xl text-base text-ink-700">
                Planned donation drives run by colleges and organisations. Register
                your interest, see the venue and timings, and track what you
                attended. Everything here is in-app — we never send you to a
                third-party ticketing site.
              </p>
            </div>

            <div>
              <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
                Open and upcoming
              </h2>
              {open.length === 0 ? (
                <div className="mt-6">
                  <EmptyState
                    title="No open drives right now"
                    description="New campus drives appear here as soon as an administrator publishes them. You will get an in-app notification when one is announced."
                    action={
                      <ButtonLink href="/donor" variant="secondary">
                        Update donor availability
                      </ButtonLink>
                    }
                  />
                </div>
              ) : (
                <div className="mt-6 grid gap-6 md:grid-cols-2">
                  {open.map((drive) => (
                    <DriveCard
                      key={drive.id}
                      drive={drive}
                      registrationStatus={mine.get(drive.id) ?? null}
                    />
                  ))}
                </div>
              )}
            </div>

            {past.length > 0 && (
              <div>
                <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
                  Finished drives
                </h2>
                <p className="mt-2 text-base text-ink-600">
                  Kept so you can see the drives you took part in.
                </p>
                <div className="mt-6 grid gap-6 md:grid-cols-2">
                  {past.map((drive) => (
                    <DriveCard
                      key={drive.id}
                      drive={drive}
                      registrationStatus={mine.get(drive.id) ?? null}
                    />
                  ))}
                </div>
              </div>
            )}

            <Alert variant="info" title="A drive does not guarantee anything">
              Campus drives are planned events with a fixed schedule and target. If
              you need blood urgently, do not wait for a drive — use the emergency
              request flow or contact a blood bank directly. Medical eligibility is
              always decided by the blood bank, never by RaktSetu.
            </Alert>

            {session.user && (
              <div className="flex flex-wrap gap-4">
                <ButtonLink href="/dashboard/donor" variant="secondary">
                  Back to donor dashboard
                </ButtonLink>
                <ButtonLink href="/notifications" variant="secondary">
                  Drive notifications
                </ButtonLink>
              </div>
            )}
          </div>
        )}
      </Section>
    </>
  );
}

