import { requireRolePage } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AVAILABILITY_LABELS } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/States";
import { VolunteerRequestCard } from "@/components/volunteer/VolunteerRequestCard";
import { LiveRefresh } from "@/components/notifications/LiveRefresh";
import type { VolunteerProfile, VolunteerRequestView } from "@/types";

export const metadata = { title: "Volunteer dashboard" };

// Session-gated: render per request so the role check is never baked into a
// static prerender (which would redirect forever in production).
export const dynamic = "force-dynamic";

/**
 * Volunteer coordination dashboard. Requests are read exclusively through
 * the volunteer_active_requests() database function, which returns only
 * safe fields — requester contact details and donor private data are not
 * reachable from this page, by design.
 */
export default async function VolunteerDashboardPage() {
  const { user, profile } = await requireRolePage("volunteer");

  const supabase = await createSupabaseServerClient();
  const [{ data: volunteer }, { data: requests }] = await Promise.all([
    supabase
      .from("volunteer_profiles")
      .select("user_id, locality, availability, created_at, updated_at")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.rpc("volunteer_active_requests", { p_limit: 50 }),
  ]);

  const activeRequests = (requests as VolunteerRequestView[] | null) ?? [];
  const assisting = activeRequests.filter((r) => r.me_assisting);
  const others = activeRequests.filter((r) => !r.me_assisting);
  const firstName = profile.full_name.trim().split(" ")[0];

  return (
    <>
      {/* Assisted-request state changes underneath the volunteer (acceptances,
          cancellation, fulfilment, expiry) arrive as this volunteer's own
          notifications, so the same shared live channel keeps this list current. */}
      <LiveRefresh />

      <PageHeader
        eyebrow="Volunteer dashboard"
        title={`Hi, ${firstName}`}
        description="You help run requests on the ground so patients never have to touch an app."
      />

      <Section>
        {volunteer ? (
          <Card glass>
            <CardBody className="flex flex-wrap items-center gap-x-10 gap-y-4 pt-2">
              <div>
                <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
                  Availability
                </p>
                <p className="text-xl font-bold text-ink-900">
                  {AVAILABILITY_LABELS[volunteer.availability]}
                </p>
              </div>
              <div>
                <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
                  Locality
                </p>
                <p className="text-xl font-bold text-ink-900">
                  {volunteer.locality ?? "Not set"}
                </p>
              </div>
              <div>
                <ButtonLink href="/profile/volunteer" variant="secondary">
                  Edit volunteer profile
                </ButtonLink>
              </div>
            </CardBody>
          </Card>
        ) : (
          <Alert variant="warning" title="Your volunteer profile is not set up yet">
            Add your locality, availability, and contact number so coordinators know
            where and when you can help.
            <div className="mt-4">
              <ButtonLink href="/profile/volunteer">Set up volunteer profile</ButtonLink>
            </div>
          </Alert>
        )}

        {volunteer?.availability === "temporarily_unavailable" && (
          <Alert variant="info" title="You are currently paused" className="mt-6">
            You can still browse requests, but switch your availability to “Available”
            in your profile when you are ready to coordinate again.
          </Alert>
        )}

        <h2 className="mt-12 text-2xl font-extrabold tracking-tight text-ink-900">
          Requests you are assisting ({assisting.length})
        </h2>
        <div className="mt-6 space-y-6">
          {assisting.length === 0 ? (
            <EmptyState
              title="Not assisting any request right now"
              description="Open an active request below and choose “Assist this request” to start coordinating."
            />
          ) : (
            assisting.map((r) => <VolunteerRequestCard key={r.id} request={r} />)
          )}
        </div>

        <h2 className="mt-12 text-2xl font-extrabold tracking-tight text-ink-900">
          Active emergency requests ({others.length})
        </h2>
        <div className="mt-6 space-y-6">
          {others.length === 0 ? (
            <EmptyState
              title="No open emergency requests"
              description="When a requester posts a new blood request, it will appear here with its hospital, urgency, and deadline."
            />
          ) : (
            others.map((r) => <VolunteerRequestCard key={r.id} request={r} />)
          )}
        </div>

        <Alert variant="info" title="Privacy, by design" className="mt-10">
          Volunteers see request details — blood group, hospital area, urgency, and
          deadline — but never a requester&apos;s phone number or a donor&apos;s private
          information. Contact details are shared only through the platform&apos;s secure
          acceptance flow, and final donor eligibility is always decided by the blood
          bank&apos;s medical screening.
        </Alert>

        <p className="mt-6 text-sm text-ink-600">
          Last refreshed {formatDateTime(new Date().toISOString())}.
        </p>
      </Section>
    </>
  );
}

