"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { updateFullName } from "@/lib/actions/profile";

/** Edits the user's display name (the one field every role can change). */
export function ProfileNameForm({ fullName }: { fullName: string }) {
  const [state, formAction, pending] = useActionState(
    updateFullName,
    initialProfileActionState
  );

  return (
    <form action={formAction} className="space-y-5">
      {state.error && <Alert variant="error">{state.error}</Alert>}
      {state.success && <Alert variant="success">{state.success}</Alert>}

      <Input
        label="Full name"
        name="fullName"
        type="text"
        autoComplete="name"
        defaultValue={fullName}
        hint="Shown to coordinators — never to the public."
        maxLength={80}
        required
      />

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save name"}
      </Button>
    </form>
  );
}
