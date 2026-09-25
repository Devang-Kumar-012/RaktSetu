import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { sanitizeNextPath } from "@/lib/profile";
import { DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD } from "@/lib/local/store";
import { Alert } from "@/components/ui/Alert";

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
    <AuthShell
      eyebrow="Welcome back"
      title="Log in to RaktSetu"
      description="Requesters, donors, volunteers, and hospital staff use the same door."
    >
      <LoginForm nextPath={nextPath} authError={authError} />

      {/*
        The admin area needs an admin to exist. Public registration deliberately
        cannot create one, so this prototype ships a single, fixed demo account.
        It is shown here rather than hidden: this is a prototype, the credential
        is not a secret, and an unreachable admin dashboard would be worse than
        an honestly-labelled demo login.
      */}
      <Alert variant="info" title="Demo administrator">
        <p>
          Email <strong>{DEMO_ADMIN_EMAIL}</strong>, password{" "}
          <strong>{DEMO_ADMIN_PASSWORD}</strong>. This account exists only in this
          browser&apos;s local prototype data. It cannot be created through sign-up.
        </p>
      </Alert>
    </AuthShell>
  );
}