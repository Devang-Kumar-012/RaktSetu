import type { Metadata } from "next";

import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";

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
              In an emergency, the hard part is rarely finding blood — it is finding a{" "}
              <strong className="font-semibold text-ink-900">
                matching donor, quickly
              </strong>
              . Phone calls go out, WhatsApp groups get flooded, and someone in the next
              neighbourhood may have been ready to help all along.
            </p>
            <p>
              RaktSetu tries to fix that. A request carries only what responders need —
              blood group, hospital, area, how soon — and matching donors nearby are
              sorted by distance instead of a hundred forwards in a group chat.
            </p>
            <p>
              The person who needs the blood is usually the least able to run around
              arranging it. So every flow here is operated by family, friends, volunteers,
              or hospital staff on their behalf.
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
                  RaktSetu does the coordination work: finding matching donors and keeping
                  a clear record of each request. The moment a donor reaches a blood bank,
                  professionals take over — screening, eligibility, collection. Software
                  stays out of that decision.
                </p>
              </CardBody>
            </Card>
          </div>
        </div>
      </Section>
    </>
  );
}
