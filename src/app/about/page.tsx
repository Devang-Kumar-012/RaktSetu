import type { Metadata } from "next";

import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { APP_NAME } from "@/lib/constants";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <>
      <PageHeader
        eyebrow="Our mission"
        title="About RaktSetu"
        description="A bridge between willing donors and urgent needs — built around one rule: the patient is never asked to work the app."
      />
      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <div className="space-y-6 text-lg leading-relaxed text-ink-600">
            <p>
              In an emergency, the hardest part is rarely finding blood — it is finding a
              <strong className="font-semibold text-ink-900"> willing, matching donor fast</strong>.
              Phone calls go out, WhatsApp groups flood, and someone in the next
              neighbourhood may have been ready to help all along.
            </p>
            <p>
              {APP_NAME} replaces that chaos with a live network. Requests carry just what
              responders need — blood group, hospital, city, urgency — and matching donors
              nearby get one clear alert instead of a hundred forwards.
            </p>
            <p>
              The person who needs the blood is often the least able to help themselves.
              That is why every flow in {APP_NAME} is operated by family, friends,
              volunteers, or hospital staff on the patient's behalf.
            </p>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>What we will never do</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="space-y-3 text-ink-600">
                  <li>Decide whether anyone is medically eligible to donate.</li>
                  <li>Sell, advertise against, or share personal data.</li>
                  <li>Collect identity documents or health records at signup.</li>
                  <li>Replace emergency medical services.</li>
                </ul>
              </CardBody>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Where the line sits</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="text-ink-600">
                  RaktSetu is logistics: matching, notifying, coordinating. The moment a
                  donor reaches a blood bank, professionals take over — screening,
                  eligibility, and collection. Software stays out of that decision,
                  always.
                </p>
              </CardBody>
            </Card>
          </div>
        </div>
      </Section>
    </>
  );
}
