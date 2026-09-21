import type { Metadata } from "next";

import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Input";
import { ComingSoon } from "@/components/ui/States";

export const metadata: Metadata = { title: "Contact & help" };

const faqs = [
  {
    q: "Does the patient need an account?",
    a: "No. Requests are created by family, friends, volunteers, or hospital staff. The patient never has to touch the app.",
  },
  {
    q: "Is RaktSetu free?",
    a: "Yes — for requesters, donors, and volunteers. There is nothing to pay and nothing sold.",
  },
  {
    q: "Who decides if a donor is eligible?",
    a: "Always the blood bank's medical staff. RaktSetu never makes eligibility or screening decisions.",
  },
];

export default function ContactPage() {
  return (
    <>
      <PageHeader
        eyebrow="Support"
        title="Contact & help"
        description="Questions, feedback, or partnership — we read everything."
      />
      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <Alert variant="error" title="Medical emergency?">
              Do not wait for a reply here. Contact your hospital or dial your local
              emergency number first.
            </Alert>

            <div className="mt-8 space-y-4">
              {faqs.map((f) => (
                <Card key={f.q}>
                  <CardHeader>
                    <CardTitle>{f.q}</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <p className="text-ink-600">{f.a}</p>
                  </CardBody>
                </Card>
              ))}
            </div>
          </div>

          <div>
            <ComingSoon
              title="Contact form goes live with accounts"
              description="Messages will be stored securely and routed to the team. For now, use the form placeholder below only as a preview — submissions are not sent yet, so nothing is falsely acknowledged."
            />
            <Card className="mt-8">
              <CardBody>
                <form aria-disabled className="space-y-5 opacity-70">
                  <Input label="Your name" name="name" placeholder="Full name" disabled />
                  <Input label="Email" name="email" type="email" placeholder="you@example.com" disabled />
                  <Textarea label="Message" name="message" placeholder="How can we help?" disabled />
                  <div>
                    <ButtonLink href="/about" variant="secondary">
                      Learn about RaktSetu instead
                    </ButtonLink>
                    <p className="mt-3 text-sm text-ink-400">
                      Sending is disabled until the backend is live.
                    </p>
                  </div>
                </form>
              </CardBody>
            </Card>
          </div>
        </div>
      </Section>
    </>
  );
}
