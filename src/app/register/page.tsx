import type { Metadata } from "next";

import { RegisterForm } from "@/components/auth/RegisterForm";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Register" };

export default function RegisterPage() {
  return (
    <>
      <PageHeader
        eyebrow="Join the network"
        title="Create your RaktSetu account"
        description="We collect the minimum: your name, email, and the role you play. No Aadhaar, no addresses, no health records at signup."
      />
      <Section className="max-w-xl">
        <Card className="p-6 sm:p-8">
          <RegisterForm />
        </Card>
      </Section>
    </>
  );
}
