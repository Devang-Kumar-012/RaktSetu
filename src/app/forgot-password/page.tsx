import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { AuthShell } from "@/components/auth/AuthShell";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Reset your password"
      description="Enter your email and we will send you a secure reset link. Nothing is revealed about whether an account exists."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
