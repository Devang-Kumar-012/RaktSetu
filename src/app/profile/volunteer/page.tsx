import { requireRolePage } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { VolunteerProfileForm } from "@/components/profile/VolunteerProfileForm";
import type { VolunteerProfile } from "@/types";

export const metadata = { title: "Volunteer profile" };

export default async function VolunteerProfilePage() {
  // Server-side authorization: only volunteers reach this page.
  const { user } = await requireRolePage("volunteer");

  const supabase = await createSupabaseServerClient();
  const { data: volunteer } = await supabase
    .from("volunteer_profiles")
    .select("user_id, locality, availability, created_at, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <>
      <PageHeader
        eyebrow="Volunteer profile"
        title="Your volunteer details"
        description="Only you and platform administrators can see this information."
      />

      <Section className="max-w-2xl">
        <Card className="p-6 sm:p-8">
          <VolunteerProfileForm volunteer={(volunteer as VolunteerProfile) ?? null} />
        </Card>

        <div className="mt-8">
          <ButtonLink href="/dashboard/volunteer" variant="secondary">
            Back to volunteer dashboard
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
