import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <PageHeader
        eyebrow="Account recovery"
        title="Reset your password"
        description="Enter your email and we will send you a secure reset link. Nothing is revealed about whether an account exists."
      />
      <Section className="max-w-xl">
        <Card className="p-6 sm:p-8">
          <ForgotPasswordForm />
        </Card>
      </Section>
    </>
  );
}
