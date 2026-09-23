import { requireAuthPage } from "@/lib/profile";
import { ROLE_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { ProfileNameForm } from "@/components/profile/ProfileNameForm";

export const metadata = { title: "My profile" };

// Session-gated: render per request so the auth check is never baked into a
// static prerender (which would redirect forever in production).
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { user, profile } = await requireAuthPage();

  return (
    <>
      <PageHeader
        eyebrow="Your account"
        title="My profile"
        description="RaktSetu collects the minimum. Only your name is editable here — roles and account status are managed by the platform."
      />

      <Section className="max-w-2xl">
        <Card glass>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-wrap gap-x-10 gap-y-4">
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
                Role
              </p>
              <p className="text-lg font-bold text-ink-900">
                {profile ? ROLE_LABELS[profile.role] : "Setting up"}
              </p>
            </div>
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
                Email
              </p>
              <p className="text-lg font-bold text-ink-900">{user.email}</p>
            </div>
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
                Status
              </p>
              <p className="text-lg font-bold text-ink-900">
                {profile?.status === "suspended" ? "Suspended" : "Active"}
              </p>
            </div>
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
                Member since
              </p>
              <p className="text-lg font-bold text-ink-900">
                {formatDate(profile?.created_at ?? user.created_at)}
              </p>
            </div>
          </CardBody>
        </Card>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Display name</CardTitle>
          </CardHeader>
          <CardBody>
            {profile ? (
              <ProfileNameForm fullName={profile.full_name} />
            ) : (
              <Alert variant="warning" title="Profile is still being set up">
                Your profile row has not been created yet, so it cannot be edited. Apply
                the database migrations (0001, 0002) if this message stays.
              </Alert>
            )}
          </CardBody>
        </Card>

        {profile?.role === "donor" && (
          <Card className="mt-8">
            <CardBody className="flex flex-wrap items-center justify-between gap-4 pt-6">
              <div>
                <CardTitle>Donor profile</CardTitle>
                <p className="mt-1 text-ink-600">
                  Blood group, locality, availability, and donation details.
                </p>
              </div>
              <ButtonLink href="/profile/donor">Open donor profile</ButtonLink>
            </CardBody>
          </Card>
        )}

        {profile?.role === "volunteer" && (
          <Card className="mt-8">
            <CardBody className="flex flex-wrap items-center justify-between gap-4 pt-6">
              <div>
                <CardTitle>Volunteer profile</CardTitle>
                <p className="mt-1 text-ink-600">Locality and availability status.</p>
              </div>
              <ButtonLink href="/profile/volunteer">Open volunteer profile</ButtonLink>
            </CardBody>
          </Card>
        )}

        {profile?.role === "requester" && (
          <Card className="mt-8">
            <CardBody className="pt-6">
              <CardTitle>Requester identity</CardTitle>
              <p className="mt-1 text-ink-600">
                Your name above is all the identification RaktSetu needs. Blood requests
                will carry no identity documents — only what responders need to help.
              </p>
            </CardBody>
          </Card>
        )}

        <div className="mt-8">
          <ButtonLink
            href={profile ? `/dashboard/${profile.role}` : "/dashboard"}
            variant="secondary"
          >
            Back to dashboard
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
