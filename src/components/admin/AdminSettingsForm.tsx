"use client";

import { useActionState } from "react";

import { updatePlatformSettings, recordDonation } from "@/lib/actions/admin";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ELIGIBILITY_DISCLAIMER } from "@/lib/donation-config";
import type { PlatformSettings } from "@/types";

/**
 * Admin coordination settings form. Server action re-validates every value;
 * RLS allows only admins to write the settings row.
 */
export function AdminSettingsForm({ settings }: { settings: PlatformSettings }) {
  const [state, formAction, pending] = useActionState(
    updatePlatformSettings,
    initialProfileActionState
  );

  return (
    <form action={formAction} className="space-y-6">
      {state.error && <Alert variant="error">{state.error}</Alert>}
      {state.success && <Alert variant="success">{state.success}</Alert>}

      <Input
        label="Emergency ring distances (km)"
        name="alertRings"
        type="text"
        defaultValue={settings.alert_rings_km.join(", ")}
        hint="Comma-separated list, expanded outward as a request stays open. e.g. 3, 7, 15"
        disabled={pending}
      />

      <Input
        label="Ring wait window (minutes)"
        name="alertWindowMinutes"
        type="number"
        min={1}
        max={240}
        defaultValue={settings.alert_window_minutes}
        hint="How long each ring is offered donors before the next, wider ring opens."
        disabled={pending}
      />

      <Input
        label="Alert due-at offset (minutes)"
        name="alertDueAtOffsetMinutes"
        type="number"
        min={15}
        max={1440}
        defaultValue={settings.alert_due_at_offset_minutes}
        hint="How far ahead of the deadline an alert asks donors to respond."
        disabled={pending}
      />

      <Input
        label="Donation interval (days)"
        name="donationIntervalDays"
        type="number"
        min={30}
        max={365}
        defaultValue={settings.donation_interval_days}
        hint={ELIGIBILITY_DISCLAIMER}
        disabled={pending}
      />

      <Alert variant="warning" title="Coordination rules, not medical rules">
        These settings control how RaktSetu coordinates donors and alerts. They never
        decide medical eligibility — the blood bank&apos;s screening is always
        authoritative and no setting here overrides it.
      </Alert>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : "Save platform settings"}
      </Button>
    </form>
  );
}

/** Admin form to record one completed donation. */
export function AdminRecordDonationForm() {
  const [state, formAction, pending] = useActionState(
    recordDonation,
    initialProfileActionState
  );

  return (
    <form action={formAction} className="space-y-5">
      {state.error && <Alert variant="error">{state.error}</Alert>}
      {state.success && <Alert variant="success">{state.success}</Alert>}

      <Input
        label="Donor account ID (uuid)"
        name="donorId"
        type="text"
        placeholder="From the users table"
        disabled={pending}
      />
      <Input
        label="Related request ID (optional, uuid)"
        name="requestId"
        type="text"
        disabled={pending}
      />
      <Input
        label="Donated on"
        name="donatedOn"
        type="date"
        disabled={pending}
      />
      <Input
        label="Units"
        name="units"
        type="number"
        min={1}
        max={10}
        defaultValue={1}
        disabled={pending}
      />

      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Recording…" : "Record donation"}
      </Button>
    </form>
  );
}
