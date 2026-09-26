"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { respondToAlert } from "@/lib/actions/alerts";
import {
  ALERT_RING_LABELS,
  BLOOD_COMPONENT_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_STYLES,
  URGENCY_LABELS,
} from "@/lib/constants";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/utils";
import type { DonorAlertRow } from "@/types";

/** Next step for an accepted alert, from the request's lifecycle state. */
function acceptedNextAction(alert: DonorAlertRow): string {
  switch (alert.request_status) {
    case "fulfilled":
      return "Request fulfilled — thank you. Once your coordinator records the donation, it will appear in your donation history below.";
    case "cancelled":
      return "This request was cancelled — no donation is needed for it.";
    case "expired":
      return "This request's deadline passed — no donation is needed for it.";
    default:
      return `Coordinate with the requester above and reach the area in ${alert.locality} before ${formatDateTime(alert.required_by)}. After you donate, your coordinator records it — it appears in your donation history below.`;
  }
}

/**
 * One emergency alert for the signed-in donor: the request facts needed to
 * decide (group, component, units, request area, approximate distance,
 * urgency, deadline, respond-by window with time left), large mobile-first
 * accept/decline buttons wired to respondToAlert → mark_alert_responded
 * (atomic, first-valid-acceptance-wins), and — only after THIS donor's own
 * acceptance while contact_shared_until (values the database itself nulls
 * out afterwards) — the requester's contact. Never shows another donor's
 * response or anyone's coordinates.
 */
export function DonorAlertCard({
  alert,
  actionable,
  minutesLeft = null,
}: {
  alert: DonorAlertRow;
  /** Computed server-side with the server clock: open, not due, unanswered. */
  actionable: boolean;
  /** Server-clock minutes until due_at, computed alongside `actionable`. */
  minutesLeft?: number | null;
}) {
  const [state, formAction, pending] = useActionState(
    respondToAlert,
    initialProfileActionState
  );

  const ringLabel = ALERT_RING_LABELS[alert.ring_km] ?? `${alert.ring_km} km`;
  const contactReady =
    alert.response === "accepted" &&
    alert.requester_contact_name !== null &&
    alert.requester_contact_phone !== null;

  let statusLine: string | null = null;
  if (alert.response === "declined") {
    statusLine = "You declined this alert — you won't be asked again for this request.";
  } else if (alert.status === "expired") {
    statusLine = "This alert closed — the request now has a donor or is no longer active.";
  } else if (alert.response === null && !actionable) {
    statusLine = "The response window for this alert has passed.";
  }

  // Anchor target for the notification centre: an "alert received" /
  // "respond soon" notification deep-links to this donor's own card.
  return (
    <Card glass id={`alert-${alert.alert_id}`} className="scroll-mt-24">
      <CardBody className="pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-2xl font-extrabold text-blood-700">
            {alert.blood_group}
          </span>
          <span className="text-base font-semibold text-ink-900">
            {BLOOD_COMPONENT_LABELS[alert.blood_component]} · {alert.units}{" "}
            {alert.units === 1 ? "unit" : "units"}
          </span>
          <span className="rounded-md border border-blood-200 bg-blood-50 px-3 py-1 text-sm font-bold text-blood-700">
            {ringLabel}
          </span>
          <span className="rounded-md bg-ink-100 px-3 py-1 text-sm font-bold text-ink-600">
            {URGENCY_LABELS[alert.urgency]}
          </span>
          {alert.approx_distance_km !== null && (
            <span className="rounded-md border border-ink-200 bg-white px-3 py-1 text-sm font-bold text-ink-600">
              ≈ {alert.approx_distance_km} km away
            </span>
          )}
          {alert.response === "accepted" && (
            <span
              className={cn(
                "rounded-md border px-3 py-1 text-sm font-bold",
                REQUEST_STATUS_STYLES[alert.request_status]
              )}
            >
              {REQUEST_STATUS_LABELS[alert.request_status]}
            </span>
          )}
        </div>

        <p className="mt-3 text-lg font-bold text-ink-900">
          {alert.locality}
        </p>
        <p className="mt-1 text-base text-ink-600">
          Needed by {formatDateTime(alert.required_by)}
          {actionable && (
            <>
              {" · respond by "}
              {formatDateTime(alert.due_at)}
              {minutesLeft !== null && <> ({minutesLeft} min left)</>}
            </>
          )}
        </p>
        {alert.note && <p className="mt-2 text-sm text-ink-600">{alert.note}</p>}

        {actionable ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <form action={formAction}>
              <input type="hidden" name="alertId" value={alert.alert_id} />
              <input type="hidden" name="response" value="accepted" />
              <Button
                type="submit"
                size="lg"
                disabled={pending}
                className="w-full min-h-12"
              >
                {pending ? "Sending…" : "I can help"}
              </Button>
            </form>
            <form action={formAction}>
              <input type="hidden" name="alertId" value={alert.alert_id} />
              <input type="hidden" name="response" value="declined" />
              <Button
                type="submit"
                variant="secondary"
                size="lg"
                disabled={pending}
                className="w-full min-h-12"
              >
                I can&apos;t help
              </Button>
            </form>
          </div>
        ) : (
          statusLine && (
            <p className="mt-4 text-sm font-semibold text-ink-600">{statusLine}</p>
          )
        )}

        {alert.response === "accepted" && (
          <>
            <p className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-base font-semibold text-green-900">
              You accepted this request
              {alert.responded_at ? ` on ${formatDateTime(alert.responded_at)}` : ""}
              .
            </p>
            <p className="mt-2 text-base text-ink-600">
              {acceptedNextAction(alert)}
            </p>
          </>
        )}

        {state.error && (
          <Alert variant="error" title="Could not record that" className="mt-4">
            {state.error}
          </Alert>
        )}
        {state.success && (
          <Alert variant="success" title="Response recorded" className="mt-4">
            {state.success}
          </Alert>
        )}

        {contactReady && (
          <Alert
            variant="success"
            title="Requester contact — coordinate directly"
            className="mt-4"
          >
            {alert.requester_contact_name} ·{" "}
            <a
              href={`tel:${alert.requester_contact_phone}`}
              className="font-bold underline"
            >
              {alert.requester_contact_phone}
            </a>
            <p className="mt-1 text-sm">
              Visible until {formatDateTime(alert.contact_shared_until)}. Final
              eligibility is always the blood bank&apos;s screening decision.
            </p>
          </Alert>
        )}
        {alert.response === "accepted" &&
          !contactReady &&
          alert.contact_shared_until !== null && (
            <p className="mt-3 text-sm text-ink-600">
              Requester contact was visible until{" "}
              {formatDateTime(alert.contact_shared_until)}.
            </p>
          )}
      </CardBody>
    </Card>
  );
}