"use client";

import { useActionState } from "react";

import { clearDonorLocation } from "@/lib/actions/location";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { Button } from "@/components/ui/Button";

/**
 * Removes the donor's stored approximate coordinates. The server action and
 * RLS enforce ownership; this is just the button + message surface.
 */
export function RemoveLocationButton({ disabled = false }: { disabled?: boolean }) {
  const [state, formAction, pending] = useActionState(
    clearDonorLocation,
    initialProfileActionState
  );

  return (
    <form action={formAction} className="inline-flex flex-col gap-2">
      <Button type="submit" variant="secondary" disabled={disabled || pending}>
        {pending ? "Removing…" : "Remove my stored location"}
      </Button>
      {state.success && (
        <p role="status" className="text-sm font-semibold text-green-700">
          {state.success}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
