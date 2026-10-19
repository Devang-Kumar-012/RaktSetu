"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { isValidEmail } from "@/lib/utils";

/**
 * Requests a password-reset email. Always shows a generic confirmation —
 * this page never reveals whether an email is registered.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    // No mail transport exists yet, so nothing is sent; the message below says so.
    setSent(true);
  }

  if (sent) {
    return (
      <Alert variant="info" title="Reset emails are not available yet">
        RaktSetu cannot send emails yet, so no link was sent to <strong>{email}</strong>.
        If you are signed in, set a new password on the reset page. Otherwise, ask an
        administrator to help you back into your account.
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error && <Alert variant="error">{error}</Alert>}

      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        hint="We will send a reset link to this address."
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />

      <Button type="submit" size="lg">
        Send reset link
      </Button>

      <p className="text-base text-ink-600">
        Remembered it after all?{" "}
        <ButtonLink href="/login" variant="ghost" className="px-0 underline">
          Back to login
        </ButtonLink>
      </p>
    </form>
  );
}
