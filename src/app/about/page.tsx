import type { Metadata } from "next";

import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { SlotImage } from "@/components/ui/SlotImage";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <>
      <PageHeader
        eyebrow="Our mission"
        title="About RaktSetu"
        description="One rule: the patient is never asked to work the app."
      />
      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <SlotImage
              slot="aboutSection"
              sizes="(max-width: 639px) 85vw, (max-width: 1024px) 60vw, 960px"
              className="w-full h-64 sm:h-80 lg:h-72"
            />
          </div>
          <div className="space-y-6 text-lg leading-relaxed text-ink-600">
            <p>
              In an emergency, the hard part is finding a matching donor quickly —
              not blood itself. Calls go out, groups get flooded, and someone nearby
              may have been ready to help all along.
            </p>
            <p>
              RaktSetu carries only what responders need — blood group, hospital,
              area, urgency — and matches donors by distance instead of a hundred
              forwards in a group chat. The person who needs blood is usually the
              least able to arrange it, so family, friends, volunteers, or hospital
              staff run the request on their behalf.
            </p>
          </div>

          <div className="space-y-6">
            <Card glass>
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
            <Card glass>
              <CardHeader>
                <CardTitle>Where the line sits</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="text-ink-600">
                  RaktSetu finds matching donors and keeps a clear record of each
                  request. The moment a donor reaches a blood bank, professionals
                  take over — screening, eligibility, collection. Software stays out
                  of that decision.
                </p>
              </CardBody>
            </Card>
          </div>
        </div>
      </Section>
    </>
  );
}
