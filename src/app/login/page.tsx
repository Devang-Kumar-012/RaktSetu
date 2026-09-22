import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/LoginForm";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { sanitizeNextPath } from "@/lib/profile";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const nextPath = sanitizeNextPath(params.next);
  const authError = params.error === "link";

  return (
    <>
      <PageHeader
        eyebrow="Welcome back"
        title="Log in to RaktSetu"
        description="Requesters, donors, volunteers, and hospital staff use the same door."
      />
      <Section className="max-w-xl">
        <Card className="p-6 sm:p-8">
          <LoginForm nextPath={nextPath} authError={authError} />
        </Card>
      </Section>
    </>
  );
}
