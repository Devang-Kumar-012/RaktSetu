"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { requestPasswordReset } from "@/lib/actions/auth";
import { isValidEmail } from "@/lib/utils";

/**
 * Requests a password-reset email. Always shows a generic confirmation —
 * this page never reveals whether an email is registered.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      const { error: sendError } = await requestPasswordReset({ email });
      if (sendError) setError(sendError);
      else setSent(true);
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-5">
        <Alert variant="success" title="Check your inbox">
          If an account exists for <strong>{email}</strong>, a reset link is on its way.
          It works once and expires in 30 minutes. Don&apos;t see it? Check your spam folder.
        </Alert>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={() => setSent(false)}>
            Use a different email
          </Button>
          <ButtonLink href="/login" variant="ghost">
            Back to login
          </ButtonLink>
        </div>
      </div>
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
        disabled={loading}
        required
      />

      <Button type="submit" size="lg" disabled={loading}>
        {loading ? "Sending…" : "Send reset link"}
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
