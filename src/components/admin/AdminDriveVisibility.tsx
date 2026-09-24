"use client";

import { useActionState } from "react";

import { setDrivePublished } from "@/lib/actions/drives";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import type { CampusDrive } from "@/types";

/**
 * Publish / hide toggle for one drive. Admin-only server action.
 *
 * Publishing is what makes a drive visible and registrable; hiding it takes it
 * back out of donors' view without touching the roster or any donation record.
 */
export function AdminDriveVisibility({ drive }: { drive: CampusDrive }) {
  const [state, formAction, pending] = useActionState(
    setDrivePublished,
    initialProfileActionState
  );

  return (
    <div className="space-y-3">
      {state.error && <Alert variant="error">{state.error}</Alert>}
      {state.success && <Alert variant="success">{state.success}</Alert>}

      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="driveId" value={drive.id} />
        {!drive.published && <input type="hidden" name="published" value="on" />}
        <Button type="submit" disabled={pending}>
          {pending
            ? "Saving…"
            : drive.published
              ? "Hide from donors"
              : "Publish drive"}
        </Button>
        <p className="text-sm text-ink-600">
          {drive.published
            ? "Currently visible and open to registrations."
            : "Currently a draft — donors cannot see this drive."}
        </p>
      </form>
    </div>
  );
}
