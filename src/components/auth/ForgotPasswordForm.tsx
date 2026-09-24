"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { AuthNotConfigured } from "@/components/auth/AuthNotConfigured";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { friendlyAuthError } from "@/lib/auth-errors";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isValidEmail } from "@/lib/utils";

/**
 * Requests a password-reset email. Always shows a generic confirmation —
 * this page never reveals whether an email is registered.
 */
export function ForgotPasswordForm() {
  const configured = isSupabaseConfigured();
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
      const supabase = createSupabaseBrowserClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
        }
      );
      if (resetError) {
        setError(friendlyAuthError(resetError));
        setLoading(false);
        return;
      }
      setSent(true);
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  if (!configured) {
    return <AuthNotConfigured action="resetting your password" />;
  }

  if (sent) {
    return (
      <Alert variant="success" title="Check your inbox">
        If an account exists for <strong>{email}</strong>, a password-reset link is on
        its way. The link works on this device only — open it in this browser.
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
