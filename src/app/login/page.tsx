import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
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
    <AuthShell
      eyebrow="Welcome back"
      title="Log in to RaktSetu"
      description="Requesters, donors, volunteers, and hospital staff use the same door."
    >
      <LoginForm nextPath={nextPath} authError={authError} />
    </AuthShell>
  );
}