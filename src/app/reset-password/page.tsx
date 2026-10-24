import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/AuthShell";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { getSessionInfo } from "@/lib/profile";
import { isPasswordResetTokenLive } from "@/lib/server/session";

export const metadata: Metadata = { title: "Set a new password" };

// Session-aware: the recovery session decides which state renders, so the
// check must run per request — never baked into a static prerender.
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const { user } = await getSessionInfo();

  // The emailed token is checked here but only spent on submit, so mail
  // scanners that open the link can't use it up. Signed-in users need no token.
  const resetToken = typeof token === "string" ? token : undefined;
  const hasRecoverySession = resetToken
    ? await isPasswordResetTokenLive(resetToken).catch(() => false)
    : Boolean(user);

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Set a new password"
      description="Choose a strong password you do not use anywhere else."
    >
      {!hasRecoverySession ? (
        <Alert variant="error" title="This reset link is not valid anymore">
          Reset links expire and work only once. Request a fresh one — it takes a
          minute.
          <div className="mt-4">
            <ButtonLink href="/forgot-password">Request a new reset link</ButtonLink>
          </div>
        </Alert>
      ) : (
        <ResetPasswordForm resetToken={resetToken} />
      )}
    </AuthShell>
  );
}
