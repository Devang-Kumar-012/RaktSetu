"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { friendlyAuthError } from "@/lib/auth-errors";
import { REGISTER_ROLES } from "@/lib/constants";
import { cn } from "@/lib/cn";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isValidEmail } from "@/lib/utils";

type Phase = "form" | "check-email";

export function RegisterForm() {
  const router = useRouter();
  const configured = isSupabaseConfigured();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<string>("donor");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (fullName.trim().length < 2) {
      setError("Please enter your full name.");
      return;
    }
    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    // Defence in depth: only the three public roles are ever sent.
    const safeRole = REGISTER_ROLES.some((r) => r.value === role) ? role : "requester";

    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim(), role: safeRole },
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/dashboard")}`,
        },
      });

      if (signUpError) {
        setError(friendlyAuthError(signUpError));
        setLoading(false);
        return;
      }

      if (data.session) {
        // Email confirmation disabled — signed in immediately.
        router.replace("/dashboard");
        router.refresh();
        return;
      }

      // Email confirmation enabled — ask them to check their inbox.
      setPhase("check-email");
      setLoading(false);
    } catch (err) {
      setError(friendlyAuthError(err));
      setLoading(false);
    }
  }

  if (!configured) {
    return (
      <Alert variant="warning" title="Authentication is not configured yet">
        The Supabase project URL and anon key are missing from this deployment.
        Add them to <code>.env.local</code> and restart the app to enable registration.
      </Alert>
    );
  }

  if (phase === "check-email") {
    return (
      <Alert variant="success" title="Almost there — confirm your email">
        We sent a confirmation link to <strong>{email}</strong>. Open it on this device
        to finish creating your account, then log in.
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error && <Alert variant="error">{error}</Alert>}

      <Input
        label="Full name"
        name="fullName"
        type="text"
        autoComplete="name"
        placeholder="Your name"
        hint="Shown to coordinators — never to the public."
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        disabled={loading}
        required
      />

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
      <div>
        <p className="mb-1.5 block text-base font-semibold text-ink-900">I am joining as</p>
        <div className="space-y-2">
          {REGISTER_ROLES.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3",
                role === option.value
                  ? "border-blood-600 bg-blood-50"
                  : "border-ink-200 bg-white hover:bg-ink-50"
              )}
            >
              <input
                type="radio"
                name="role"
                value={option.value}
                checked={role === option.value}
                onChange={() => setRole(option.value)}
                disabled={loading}
                className="mt-1.5 h-4 w-4 accent-blood-700"
              />
              <span>
                <span className="block font-semibold text-ink-900">{option.label}</span>
                <span className="block text-sm text-ink-600">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder="At least 8 characters"
        hint="Use 8+ characters. A passphrase is easiest to remember."
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={loading}
        required
      />

      <Input
        label="Confirm password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        placeholder="Type the same password again"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        disabled={loading}
        required
      />

      <Button type="submit" size="lg" disabled={loading}>
        {loading ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-base text-ink-600">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-blood-700 hover:underline">
          Log in
        </Link>
      </p>

      <p className="text-sm text-ink-400">
        Administrator accounts are provisioned internally and cannot be created here.
      </p>
    </form>
  );
}
