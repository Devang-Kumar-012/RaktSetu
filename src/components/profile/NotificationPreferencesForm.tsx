"use client";

import { useActionState } from "react";

import { updateNotificationPreferences } from "@/lib/actions/notifications";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { NOTIFICATION_PREFERENCE_CATEGORIES } from "@/lib/constants";
import type { NotificationPreferences } from "@/types";

/**
 * The caller's own notification preferences.
 *
 * Only ADVISORY categories are switchable. The copy states plainly that
 * emergency notifications cannot be turned off, because an emergency alert is
 * the entire point of the platform — offering a "mute emergencies" toggle would
 * be a dangerous lie, so there is deliberately no such control here.
 *
 * The row is upserted by the server from the SESSION user id, never from a form
 * field, and RLS scopes the write to the caller's own row.
 */
export function NotificationPreferencesForm({
  preferences,
}: {
  preferences: NotificationPreferences | null;
}) {
  const [state, formAction, pending] = useActionState(
    updateNotificationPreferences,
    initialProfileActionState
  );

  return (
    <form action={formAction} className="space-y-5">
      {state.error && <Alert variant="error">{state.error}</Alert>}
      {state.success && <Alert variant="success">{state.success}</Alert>}

      <fieldset className="space-y-4">
        <legend className="sr-only">Advisory notification categories</legend>
        {NOTIFICATION_PREFERENCE_CATEGORIES.map((cat) => (
          <label
            key={cat.key}
            className="flex cursor-pointer items-start gap-3 rounded-md border border-ink-200 p-4"
          >
            <input
              type="checkbox"
              name={cat.key}
              defaultChecked={preferences?.[cat.key] ?? true}
              disabled={pending}
              className="mt-1 h-5 w-5 shrink-0"
            />
            <span>
              <span className="block text-base font-semibold text-ink-900">
                {cat.label}
              </span>
              <span className="mt-1 block text-sm text-ink-600">
                {cat.description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <Alert variant="info" title="Emergency notifications cannot be turned off">
        Alerts when someone nearby needs blood, acceptances, request outcomes
        and account changes are always delivered. They are not a marketing or
        engagement choice — they are the emergency workflow.
      </Alert>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save notification preferences"}
      </Button>
    </form>
  );
}
