import { requireRolePage } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DONATION_INTERVAL_LABEL } from "@/lib/donation-config";
import { getDonorEligibility } from "@/lib/eligibility";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { DonorProfileForm } from "@/components/profile/DonorProfileForm";
import { RemoveLocationButton } from "@/components/profile/RemoveLocationButton";
import type { DonorProfile } from "@/types";

export const metadata = { title: "Donor profile" };

// Session-gated: render per request so the role check is never baked into a
// static prerender (which would redirect forever in production).
export const dynamic = "force-dynamic";

export default async function DonorProfilePage() {
  // Server-side authorization: only donors reach this page.
  const { user } = await requireRolePage("donor");

  const supabase = await createSupabaseServerClient();
  const { data: donor } = await supabase
    .from("donor_profiles")
    .select(
      "user_id, blood_group, locality, last_donation_date, phone, latitude, longitude, availability, donation_count, created_at, updated_at"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  const donorProfile = (donor as DonorProfile) ?? null;
  const eligibility = getDonorEligibility(donorProfile);

  return (
    <>
      <PageHeader
        eyebrow="Donor profile"
        title="Your donor details"
        description="Only you and platform administrators can see this information."
      />

      <Section className="max-w-2xl">
        <Card className="p-6 sm:p-8">
          <DonorProfileForm donor={donorProfile} />
        </Card>

        {donorProfile && (
          <Card className="mt-8">
            <CardBody className="pt-6">
              <h2 className="text-lg font-bold text-ink-900">Your stored location</h2>
              <p className="mt-2 text-base text-ink-600">
                {donorProfile.latitude !== null && donorProfile.longitude !== null
                  ? "A rough map point (about 1 km precision) is saved with your locality. Requesters can't see it — matching only uses it to estimate distance."
                  : "No map point saved. Matching still works with your locality text; you just won't be distance-sorted."}
              </p>
              <div className="mt-4">
                <RemoveLocationButton
                  disabled={
                    donorProfile.latitude === null || donorProfile.longitude === null
                  }
                />
              </div>
            </CardBody>
          </Card>
        )}

        {donorProfile && (
          <Alert
            variant={eligibility.status === "available" ? "success" : "info"}
            title="Current matching status"
            className="mt-8"
          >
            {eligibility.status === "available" &&
              "You are available and past the donation interval — you can be matched."}
            {eligibility.status === "temporarily_unavailable" &&
              "You are paused. You will not appear in matching results until you switch back to available."}
            {eligibility.status === "not_currently_eligible" &&
              `Your last donation was on ${donorProfile.last_donation_date}. Based on the ${DONATION_INTERVAL_LABEL} interval, you return to matching on ${eligibility.nextEligibleLabel}.`}
          </Alert>
        )}

        <Alert variant="info" title="How your phone number is protected" className="mt-6">
          Your phone number is stored in a private, row-level-security-protected table.
          Other users can never query it, and the donor matching view intentionally
          excludes it. In the future, it would be revealed to a requester only after you
          explicitly accept their blood request.
        </Alert>

        <Alert variant="info" title="About eligibility" className="mt-6">
          RaktSetu never decides medical eligibility. The next-eligible date shown here
          is an application-level availability filter only — final eligibility is always
          determined by the blood bank&apos;s medical screening.
        </Alert>

        <div className="mt-8">
          <ButtonLink href="/dashboard/donor" variant="secondary">
            Back to donor dashboard
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
