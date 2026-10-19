import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { getSessionInfo, sanitizeNextPath } from "@/lib/profile";
import { DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD } from "@/lib/demo-account";
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
  // Server-side, never from cookie presence alone (see register/page.tsx).
  if ((await getSessionInfo()).user) redirect(nextPath);

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
          <strong>{DEMO_ADMIN_PASSWORD}</strong>. It is seeded into the
          deployment&apos;s own database on first start, and cannot be created
          through sign-up.
        </p>
      </Alert>
    </AuthShell>
  );
}