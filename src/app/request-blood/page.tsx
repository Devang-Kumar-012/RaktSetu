import type { Metadata } from "next";

import { getSessionInfo } from "@/lib/profile";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { BloodRequestForm } from "@/components/requests/BloodRequestForm";
import { BLOOD_GROUPS } from "@/lib/constants";

export const metadata: Metadata = { title: "Request blood" };

export default async function RequestBloodPage() {
  const session = await getSessionInfo();
  const isRequester =
    session.configured &&
    session.user !== null &&
    session.profile?.role === "requester" &&
    session.profile.status === "active";
  const requesterName = isRequester && session.profile ? session.profile.full_name : "";

  return (
    <>
      <PageHeader
        eyebrow="Urgent help"
        title="Request blood"
        description="Reach willing, matching donors nearby — without the patient ever needing to operate anything."
      />
      <Section>
        {!isRequester ? (
          <div className="max-w-2xl">
            <Alert variant="info" title="One quick account needed">
              Blood requests are created by a family member, friend, or volunteer with a
              requester account — the patient never touches the app. If that&apos;s you,
              create a free requester account (or log in) and come straight back here.
            </Alert>
            {!session.user && (
              <div className="mt-6 flex flex-wrap gap-4">
                <ButtonLink href="/register?role=requester">Create requester account</ButtonLink>
                <ButtonLink href="/login?next=/request-blood" variant="secondary">
                  Log in
                </ButtonLink>
              </div>
            )}
            {session.user && !isRequester && (
              <div className="mt-6">
                <ButtonLink href="/dashboard" variant="secondary">
                  Go to my dashboard
                </ButtonLink>
              </div>
            )}

            <div className="mt-12 space-y-6">
              {[
                {
                  title: "Someone on the ground creates the request",
                  body: "A family member, friend, or volunteer enters the hospital, city, and blood group. The patient does not touch the app.",
                },
                {
                  title: "Matching runs against nearby donors",
                  body: "RaktSetu looks for willing donors with the right blood group near that hospital and sorts them by distance. Contacting them is still done by hand while alerts are being built.",
                },
                {
                  title: "The donor is confirmed, then screened",
                  body: "Once a donor agrees, they go through the usual medical eligibility checks at the blood bank. RaktSetu never decides who is fit to donate.",
                },
              ].map((s, i) => (
                <Card key={s.title}>
                  <CardBody className="pt-6">
                    <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
                      Step {i + 1}
                    </p>
                    <h2 className="mt-1 text-xl font-bold tracking-tight text-ink-900">
                      {s.title}
                    </h2>
                    <p className="mt-2 text-ink-600">{s.body}</p>
                  </CardBody>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl">
            <Alert variant="warning" title="Emergency?">
              RaktSetu is a coordination tool, not an emergency service. For immediate
              medical emergencies, contact your hospital or emergency services first.
            </Alert>

            <Card className="mt-8 p-6 sm:p-8">
              <BloodRequestForm contactName={requesterName} />
            </Card>
          </div>
        )}

        <div className="mt-12">
          <Card className="max-w-3xl">
            <CardBody className="pt-6">
              <p className="font-semibold text-ink-900">Blood groups we support</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {BLOOD_GROUPS.map((g) => (
                  <span
                    key={g}
                    className="rounded-md border border-ink-200 bg-ink-50 px-4 py-2 text-base font-bold text-ink-900"
                  >
                    {g}
                  </span>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      </Section>
    </>
  );
}
