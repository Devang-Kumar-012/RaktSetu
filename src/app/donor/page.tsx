import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader, Section } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { BecomeDonorButton } from "@/components/auth/BecomeDonorButton";
import { DonorMotivation } from "@/components/donor/DonorMotivation";
import { getSessionInfo } from "@/lib/profile";

export const metadata: Metadata = { title: "Become a donor" };

// Session-aware, so it must render per request. A static prerender would freeze
// the signed-out state and a signed-in requester would be told to register again.
export const dynamic = "force-dynamic";

const points = [
  {
    title: "What we ask for",
    body: "Your blood group, your area, a phone number, and whether you are available right now. Nothing else — no health history, no home address.",
  },
  {
    title: "You stay in control",
    body: "Switch yourself to “temporarily unavailable” whenever you need to. Your phone number stays private and is never listed anywhere. You can also remove your saved location at any time.",
  },
  {
    title: "Screening stays professional",
    body: "RaktSetu only keeps track of when you last donated and shows the earliest date you could donate again. That is a booking filter, not a medical decision — the blood bank's staff always decides.",
  },
];

/**
 * THREE STATES, ONE ACCOUNT MODEL.
 *
 * RaktSetu is one account per person with several roles, so this page must never
 * tell a signed-in person to "create a donor account" — they would be invited to
 * register a second user for something their existing account can simply hold.
 *
 *   - already a donor      → straight to the donor profile, which is the state
 *                           they actually asked for;
 *   - signed in, not a donor → add the donor role to THIS account and continue
 *                           to the form, keeping every other role and all data;
 *   - signed out          → the original "create a donor account" path, plus the
 *                           "I already have an account" route to sign in first.
 */
export default async function DonorPage() {
  const { user, roles } = await getSessionInfo();

  // A donor has nothing to decide here; the profile form is the destination.
  if (user && roles.includes("donor")) redirect("/profile/donor");

  return (
    <>
      <PageHeader
        eyebrow="Donate"
        title="Become a donor"
        description="Register once with your blood group and area. Update your availability whenever your situation changes."
      />
      <Section>
        <DonorMotivation />

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {points.map((c) => (
            <Card key={c.title} glass>
              <CardHeader>
                <CardTitle>{c.title}</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="text-ink-600">{c.body}</p>
              </CardBody>
            </Card>
          ))}
        </div>

        {user ? (
          // Signed in without the donor role: same account, one more role.
          <div className="mt-12 max-w-2xl">
            <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
              Add the donor role to your account
            </h2>
            <p className="mt-3 text-lg text-ink-600">
              You are already signed in as <strong>{user.email}</strong>, so there is
              nothing new to create. Add the donor role to this account and we will
              take you straight to your donor profile. Everything you can already do
              as a {roles.length === 1 ? roles[0] : "member of this account"} stays
              exactly as it is, and you can switch between profiles at any time.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <BecomeDonorButton />
              <ButtonLink href="/profile" variant="secondary" size="lg">
                View my profiles
              </ButtonLink>
            </div>
          </div>
        ) : (
          // Signed out: keep the original registration path.
          <div className="mt-12 max-w-2xl">
            <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
              Ready to register?
            </h2>
            <p className="mt-3 text-lg text-ink-600">
              Create a donor account, then fill in your donor profile. It takes a
              couple of minutes, and you can edit everything later from your profile
              page.
            </p>
            <div className="mt-6 flex flex-wrap gap-4">
              <ButtonLink href="/register?role=donor" size="lg">
                Create a donor account
              </ButtonLink>
              <ButtonLink href="/login" variant="secondary" size="lg">
                I already have an account
              </ButtonLink>
            </div>
          </div>
        )}

        <div className="mt-12 max-w-2xl">
          <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
            How alerts reach you
          </h2>
          <p className="mt-3 text-lg text-ink-600">
            When a request matches your blood group, RaktSetu alerts donors in expanding
            rings — nearby first (3 km), then wider (7 km, then 15 km) if nobody accepts,
            with a short window per ring. Alerts appear on your dashboard and under
            Notifications: accept or decline with one tap. Only after you accept do you
            get the requester&apos;s contact to coordinate — and the blood bank&apos;s
            screening always comes first.
          </p>
        </div>
      </Section>
    </>
  );
}
