import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/AuthShell";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { getSessionInfo } from "@/lib/profile";

export const metadata: Metadata = { title: "Set a new password" };

// Session-aware: the recovery session decides which state renders, so the
// check must run per request — never baked into a static prerender.
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const { configured, user } = await getSessionInfo();

  // A valid recovery session is required to change the password.
  // If the link is missing, expired, or already used, say so plainly.
  const hasRecoverySession = Boolean(user);

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Set a new password"
      description="Choose a strong password you do not use anywhere else."
    >
      {!configured ? (
        <Alert variant="warning" title="Authentication is not configured yet">
          The Supabase project URL and anon key are missing from this deployment.
        </Alert>
      ) : !hasRecoverySession ? (
        <Alert variant="error" title="This reset link is not valid anymore">
          Reset links expire and work only once. Request a fresh one — it takes a
          minute.
          <div className="mt-4">
            <ButtonLink href="/forgot-password">Request a new reset link</ButtonLink>
          </div>
        </Alert>
      ) : (
        <ResetPasswordForm />
      )}
    </AuthShell>
  );
}
