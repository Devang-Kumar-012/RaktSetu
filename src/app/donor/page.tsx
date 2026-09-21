import type { Metadata } from "next";

import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { ComingSoon } from "@/components/ui/States";

export const metadata: Metadata = { title: "Become a donor" };

const commitments = [
  {
    title: "Register once",
    body: "Your blood group, city, and preferred contact method. That is all we ask for — no health history forms.",
  },
  {
    title: "Get alerted only when it matters",
    body: "You are notified when a verified request matches your blood group nearby. Mute anytime.",
  },
  {
    title: "Screening stays professional",
    body: "RaktSetu tracks that you donated and when — eligibility is always decided by the blood bank's medical staff, never by our software.",
  },
];

export default function DonorPage() {
  return (
    <>
      <PageHeader
        eyebrow="Donate"
        title="Become a donor"
        description="One registration. Then, only when someone nearby genuinely needs your blood type, you will hear from us."
      />
      <Section>
        <div className="grid gap-6 md:grid-cols-3">
          {commitments.map((c) => (
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

        <div className="mt-12">
          <ComingSoon
            title="Donor registration is coming online"
            description="Donor profiles will be stored in Supabase with row-level security, so your data is only visible to you and the coordination features you opt into. Until launch, this page explains the commitment — it does not collect your details yet."
          />
        </div>
      </Section>
    </>
  );
}
