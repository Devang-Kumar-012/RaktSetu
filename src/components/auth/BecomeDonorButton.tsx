"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { addRoleToCurrentAccount } from "@/lib/actions/auth";
import { Button } from "@/components/ui/Button";

/**
 * "Become a donor" for an account that is already signed in.
 *
 * This adds the donor role to the CURRENT account. It does not create a user,
 * does not ask for another email, and does not touch the account's other roles —
 * it calls the same `addRoleToCurrentAccount` server action the role switcher
 * already uses, which grants a membership on the session's own user id and
 * refuses anything outside the publicly-grantable roles (so `admin` is
 * unreachable from here by construction).
 *
 * On success the user is sent to the donor profile form, which is the actual
 * next step — the role is what unlocks it, and nothing else needs creating.
 */
export function BecomeDonorButton({ label = "Become a donor" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setBusy(true);
    setError(null);
    startTransition(async () => {
      const result = await addRoleToCurrentAccount({ role: "donor" });
      setBusy(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      // Straight to the form the new role just unlocked.
      router.push("/profile/donor");
      router.refresh();
    });
  }

  return (
    <div>
      <Button size="lg" onClick={run} disabled={pending || busy}>
        {busy ? "Adding donor role…" : label}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
