"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { AuthNotConfigured } from "@/components/auth/AuthNotConfigured";
import { Button } from "@/components/ui/Button";
import { Input, PasswordInput } from "@/components/ui/Input";
import { friendlyAuthError } from "@/lib/auth-errors";
import { isSupabaseConfigured } from "@/lib/env";
import { isValidEmail } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm({
  nextPath,
  authError = false,
}: {
  nextPath: string;
  authError?: boolean;
}) {
  const router = useRouter();
  const configured = isSupabaseConfigured();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    authError
      ? "That sign-in link is invalid or has expired. Please log in again below."
      : null
  );
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Please enter your password.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(friendlyAuthError(signInError));
        setLoading(false);
        return;
      }

      // Full refresh so every server component re-reads the new session.
      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      setError(friendlyAuthError(err));
      setLoading(false);
    }
  }

  if (!configured) {
    return <AuthNotConfigured action="logging in" />;
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
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={loading}
        required
      />

      <PasswordInput
        label="Password"
        name="password"
        autoComplete="current-password"
        placeholder="Your password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={loading}
        required
      />

      <div className="flex items-center justify-between gap-4">
        <Button type="submit" size="lg" disabled={loading}>
          {loading ? "Logging in…" : "Log in"}
        </Button>
        <Link
          href="/forgot-password"
          className="font-semibold text-blood-700 hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      <p className="text-base text-ink-600">
        New to RaktSetu?{" "}
        <Link href="/register" className="font-semibold text-blood-700 hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
