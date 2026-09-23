"use client";

import { useActionState } from "react";

import { setUserStatus } from "@/lib/actions/admin";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";

/**
 * Admin account-status controls. Every rule is enforced again by the server
 * action and by RLS (admins only, never on their own row) — these buttons
 * are the convenient entry point only.
 */
export function AdminUserStatusControls({
  userId,
  status,
  isSelf,
}: {
  userId: string;
  status: string;
  isSelf: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    setUserStatus,
    initialProfileActionState
  );

  if (isSelf) {
    return <span className="text-sm text-ink-600">This is you</span>;
  }

  return (
    <div className="space-y-2">
      <form action={formAction} className="flex gap-2">
        <input type="hidden" name="userId" value={userId} />
        <input
          type="hidden"
          name="nextStatus"
          value={status === "suspended" ? "active" : "suspended"}
        />
        <Button
          type="submit"
          variant={status === "suspended" ? "primary" : "danger"}
          disabled={pending}
        >
          {pending
            ? "Updating…"
            : status === "suspended"
              ? "Activate"
              : "Suspend"}
        </Button>
      </form>
      {state.error && <p className="text-sm font-medium text-red-600">{state.error}</p>}
      {state.success && (
        <p role="status" className="text-sm font-semibold text-green-700">
          {state.success}
        </p>
      )}
    </div>
  );
}
