import type { Metadata } from "next";

import { PageHeader, Section } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ComingSoon } from "@/components/ui/States";

export const metadata: Metadata = { title: "Log in" };

export default function LoginPage() {
  return (
    <>
      <PageHeader
        eyebrow="Welcome back"
        title="Log in to RaktSetu"
        description="Requesters, donors, volunteers, and hospital staff use the same door."
      />
      <Section className="max-w-xl">
        <ComingSoon
          title="Login is being wired up"
          description="Secure authentication with Supabase is the next milestone. Your credentials are never stored by this site — only by Supabase, the authentication provider. Until it is live, there is intentionally no fake login form here."
        />
        <Card className="mt-8">
          <div className="flex flex-col gap-3 p-6">
            <p className="font-semibold text-ink-900">Need something sooner?</p>
            <p className="text-ink-600">
              Browse the public pages while we finish accounts — or create your account
              first and we will email you when login goes live.
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              <ButtonLink href="/register">Create account</ButtonLink>
              <ButtonLink href="/" variant="secondary">Back to home</ButtonLink>
            </div>
          </div>
        </Card>
      </Section>
    </>
  );
}
