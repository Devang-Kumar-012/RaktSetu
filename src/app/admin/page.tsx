import type { Metadata } from "next";

import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { ComingSoon } from "@/components/ui/States";

export const metadata: Metadata = { title: "Administration" };

const capabilities = [
  {
    title: "Verify requesters and hospitals",
    body: "Admins review new hospital and blood-bank accounts before they can act on requests.",
  },
  {
    title: "Oversee live requests",
    body: "A queue of open requests with status, city, and matching donor counts — for coordination, not diagnosis.",
  },
  {
    title: "Guard the network",
    body: "Abuse monitoring and account actions, with every change written to an audit log.",
  },
];

export default function AdminPage() {
  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Admin"
        description="Tools for the people keeping RaktSetu trustworthy."
      />
      <Section>
        <Alert variant="warning" title="Restricted area">
          Admin access will be limited to provisioned administrator accounts with
          role-based policies enforced in the database. Public registration will never
          create an admin.
        </Alert>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {capabilities.map((c) => (
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
            title="The admin console is under construction"
            description="The first admin capability to ship will be request oversight, backed by row-level-security policies that make privilege escalation impossible from the client."
          />
        </div>
      </Section>
    </>
  );
}
