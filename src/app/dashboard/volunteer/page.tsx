import { requireRolePage } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AVAILABILITY_LABELS } from "@/lib/constants";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { ComingSoon } from "@/components/ui/States";

export const metadata = { title: "Volunteer dashboard" };

export default async function VolunteerDashboardPage() {
  const { user, profile } = await requireRolePage("volunteer");

  const supabase = await createSupabaseServerClient();
  const { data: volunteer } = await supabase
    .from("volunteer_profiles")
    .select("user_id, locality, availability, created_at, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const firstName = profile.full_name.trim().split(" ")[0];

  return (
    <>
      <PageHeader
        eyebrow="Volunteer dashboard"
        title={`Hi, ${firstName}`}
        description="You help run requests on the ground so patients never have to touch an app."
      />

      <Section>
        {volunteer ? (
          <Card>
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
            Add your locality and availability so coordinators know where and when you
            can help.
            <div className="mt-4">
              <ButtonLink href="/profile/volunteer">Set up volunteer profile</ButtonLink>
            </div>
          </Alert>
        )}

        <h2 className="mt-12 text-2xl font-extrabold tracking-tight text-ink-900">
          Coming to your dashboard
        </h2>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <ComingSoon
            title="Verify & coordinate requests"
            description="Tools for confirming hospitals, checking request details, and helping fulfilments are being built right now."
          />
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle>Questions?</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-1 flex-col justify-between gap-6">
              <p className="text-ink-600">
                Want to pilot RaktSetu in your area or help shape the volunteer tools?
                Talk to the team.
              </p>
              <div>
                <ButtonLink href="/contact" variant="secondary">
                  Contact the team
                </ButtonLink>
              </div>
            </CardBody>
          </Card>
        </div>
      </Section>
    </>
  );
}
