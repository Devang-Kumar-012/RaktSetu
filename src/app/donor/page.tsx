import type { Metadata } from "next";

import { PageHeader, Section } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { ComingSoon } from "@/components/ui/States";

export const metadata: Metadata = { title: "Become a donor" };

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

export default function DonorPage() {
  return (
    <>
      <PageHeader
        eyebrow="Donate"
        title="Become a donor"
        description="Register once with your blood group and area. Update your availability whenever your situation changes."
      />
      <Section>
        <div className="grid gap-6 md:grid-cols-3">
          {points.map((c) => (
            <Card key={c.title}>
              <CardHeader>
                <CardTitle>{c.title}</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="text-ink-600">{c.body}</p>
              </CardBody>
            </Card>
          ))}
        </div>

        <div className="mt-12 max-w-2xl">
          <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
            Ready to register?
          </h2>
          <p className="mt-3 text-lg text-ink-600">
            Create a donor account, then fill in your donor profile. It takes a couple of
            minutes, and you can edit everything later from your profile page.
          </p>
          <div className="mt-6 flex flex-wrap gap-4">
            <ButtonLink href="/register" size="lg">
              Create a donor account
            </ButtonLink>
            <ButtonLink href="/login" variant="secondary" size="lg">
              I already have an account
            </ButtonLink>
          </div>
        </div>

        <div className="mt-12">
          <ComingSoon
            title="Alerts are the next step"
            description="Request matching is built, but notifications are not live yet, so donors will not receive anything until that ships. Until then you can register and keep your availability up to date."
          />
        </div>
      </Section>
    </>
  );
}
