import type { Metadata } from "next";

import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { ComingSoon } from "@/components/ui/States";
import { BLOOD_GROUPS } from "@/lib/constants";

export const metadata: Metadata = { title: "Request blood" };

const steps = [
  {
    title: "Someone on the ground creates the request",
    body: "A family member, friend, or volunteer enters the hospital, city, and blood group. The patient does not touch the app.",
  },
  {
    title: "Nearby matching donors are alerted",
    body: "RaktSetu notifies willing donors with the right blood group in that city — clearly and without spam.",
  },
  {
    title: "Screening happens at the blood bank",
    body: "The confirmed donor goes through the normal medical eligibility checks. RaktSetu never decides who is fit to donate.",
  },
];

export default function RequestBloodPage() {
  return (
    <>
      <PageHeader
        eyebrow="Urgent help"
        title="Request blood"
        description="Reach willing, matching donors nearby — without the patient ever needing to operate anything."
      />
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div className="space-y-6">
            {steps.map((s, i) => (
              <Card key={s.title}>
                <CardHeader>
                  <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
                    Step {i + 1}
                  </p>
                  <CardTitle>{s.title}</CardTitle>
                </CardHeader>
                <CardBody>
                  <p className="text-ink-600">{s.body}</p>
                </CardBody>
              </Card>
            ))}
          </div>

          <div className="space-y-6">
            <ComingSoon
              title="Request creation is coming online"
              description="The request form will go live together with accounts and RLS-protected request storage. It will only ask for what responders need: blood group, hospital, city, urgency, and a contact route — never the patient's identity documents."
            />
            <Alert variant="warning" title="Emergency?">
              RaktSetu is a coordination tool, not an emergency service. For immediate
              medical emergencies, contact your hospital or emergency services first.
            </Alert>
            <Card>
              <CardBody>
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
        </div>
      </Section>
    </>
  );
}
