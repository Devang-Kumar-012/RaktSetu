import type { Metadata } from "next";

import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { ComingSoon } from "@/components/ui/States";

export const metadata: Metadata = { title: "Dashboard" };

const previews = [
  { title: "Your requests", body: "Track blood requests you have created or are helping with." },
  { title: "Donor alerts", body: "See nearby requests matching your blood group." },
  { title: "Activity log", body: "Every confirmation and update, in one timeline." },
];

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        eyebrow="Your account"
        title="Dashboard"
        description="One place for your requests, donor alerts, and activity."
      />
      <Section>
        <ComingSoon
          title="The dashboard arrives with accounts"
          description="This space will show your live requests, matching donor alerts, and activity history once Supabase authentication is switched on. It is deliberately empty now — nothing here fakes data."
        />
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {previews.map((p) => (
            <Card key={p.title}>
              <CardHeader>
                <CardTitle>{p.title}</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="text-ink-600">{p.body}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}
