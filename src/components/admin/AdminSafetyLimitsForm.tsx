"use client";

import { useActionState } from "react";

import { updateSafetyLimits } from "@/lib/actions/admin";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SAFETY_LIMITS_BOUNDS } from "@/lib/constants";
import type { PlatformSafetyLimits } from "@/types";

/**
 * Admin editor for the anti-abuse limits (migration 0014).
 *
 * These are the ONLY place a limit is configured: the database triggers read
 * the single platform_safety_limits row rather than hard-coded numbers, so
 * tuning abuse protection never requires a code change or a redeploy.
 *
 * Deliberately framed as abuse protection, not as a way to ration emergencies:
 * the defaults are set high, and the warning below says plainly that a genuine
 * emergency must never be turned away.
 */
export function AdminSafetyLimitsForm({ limits }: { limits: PlatformSafetyLimits }) {
  const [state, formAction, pending] = useActionState(
    updateSafetyLimits,
    initialProfileActionState
  );
  const B = SAFETY_LIMITS_BOUNDS;

  return (
    <form action={formAction} className="space-y-6">
      {state.error && <Alert variant="error">{state.error}</Alert>}
      {state.success && <Alert variant="success">{state.success}</Alert>}

      <Input
        label="Active requests per requester"
        name="maxActiveRequestsPerRequester"
        type="number"
        min={B.activeRequests.min}
        max={B.activeRequests.max}
        defaultValue={limits.max_active_requests_per_requester}
        hint={`How many live emergencies one requester may have open at once (${B.activeRequests.min}–${B.activeRequests.max}).`}
        disabled={pending}
      />
      <Input
        label="Seconds between requests"
        name="minRequestIntervalSeconds"
        type="number"
        min={B.requestIntervalSeconds.min}
        max={B.requestIntervalSeconds.max}
        defaultValue={limits.min_request_interval_seconds}
        hint="Stops double-submits and create/cancel/re-create spam."
        disabled={pending}
      />
      <Input
        label="Requests per hour"
        name="maxRequestsPerHour"
        type="number"
        min={B.requestsPerHour.min}
        max={B.requestsPerHour.max}
        defaultValue={limits.max_requests_per_hour}
        hint="Rolling limit so the active-request cap cannot be side-stepped."
        disabled={pending}
      />
      <Input
        label="Reports per user per day"
        name="maxReportsPerDay"
        type="number"
        min={B.reportsPerDay.min}
        max={B.reportsPerDay.max}
        defaultValue={limits.max_reports_per_day}
        hint="Caps report spam across all requests."
        disabled={pending}
      />
      <Input
        label="Alert responses per donor per minute"
        name="maxAlertResponsesPerMinute"
        type="number"
        min={B.responsesPerMinute.min}
        max={B.responsesPerMinute.max}
        defaultValue={limits.max_alert_responses_per_minute}
        hint="Only stops a runaway client loop; a real donor answers a handful."
        disabled={pending}
      />

      <Alert variant="warning" title="Set these generously">
        These limits exist to stop mass spam and abuse. They must never be tight
        enough to refuse a genuine emergency — keep them high, and remind people
        to contact a blood bank directly in an emergency.
      </Alert>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save safety limits"}
      </Button>
    </form>
  );
}
