"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input, PasswordInput } from "@/components/ui/Input";
import { signInWithPassword } from "@/lib/actions/auth";
import { friendlyAuthError } from "@/lib/auth-errors";
import { isValidEmail } from "@/lib/utils";

export function LoginForm({
  nextPath,
  authError = false,
}: {
  nextPath: string;
  authError?: boolean;
}) {
  const router = useRouter();

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
      // The password is verified on the SERVER, which then sets an HTTP-only
      // session cookie. Nothing about the account is decided in this browser.
      const result = await signInWithPassword(email.trim(), password);

      if (result.error) {
        setError(friendlyAuthError(result.error));
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
