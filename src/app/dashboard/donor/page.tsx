import { requireRolePage } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { ComingSoon } from "@/components/ui/States";
import { DonorStatusBadges } from "@/components/donor/DonorStatusBadges";
import type { DonorProfile } from "@/types";

export const metadata = { title: "Donor dashboard" };

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
          <DonorStatusBadges donor={donorProfile} />
        )}

        <h2 className="mt-12 text-2xl font-extrabold tracking-tight text-ink-900">
          Coming to your dashboard
        </h2>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <ComingSoon
            title="Nearby request matching"
            description="When a verified request matches your blood group near your locality, you will be alerted here — only while you are available and past the donation interval."
          />
          <ComingSoon
            title="Donation history"
            description="A record of the requests you responded to. Your eligibility is always decided by the blood bank's medical staff, never by RaktSetu."
          />
        </div>
      </Section>
    </>
  );
}
