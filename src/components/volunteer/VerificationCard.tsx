"use client";

import { useActionState, useEffect, useState } from "react";

import {
  completeVerification,
  escalateVerification,
} from "@/lib/actions/verifications";
import { initialProfileActionState } from "@/lib/actions/action-state";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { BLOOD_COMPONENT_LABELS, URGENCY_LABELS } from "@/lib/constants";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/utils";
import type { PendingVerificationView } from "@/types";

/**
 * Formats a whole-minute countdown into "Xm Ys" or "Overdue".
 */
function formatCountdown(minutesLeft: number | null): string {
  if (minutesLeft === null) return "—";
  if (minutesLeft <= 0) return "Overdue";
  const h = Math.floor(minutesLeft / 60);
  const m = minutesLeft % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * One pending verification task on the volunteer dashboard. Shows the request
 * facts (safe fields only — no requester contact, no donor private data), a
 * live countdown to the deadline, and Verified / Rejected / Escalate controls.
 *
 * The server actions and database functions enforce every rule — these
 * controls are the convenient entry point only.
 */
export function VerificationCard({
  verification,
  escalationTargets,
}: {
  verification: PendingVerificationView;
  escalationTargets?: { id: string; full_name: string }[];
}) {
  const [completeState, completeAction, completePending] = useActionState(
    completeVerification,
    initialProfileActionState
  );
  const [escalateState, escalateAction, escalatePending] = useActionState(
    escalateVerification,
    initialProfileActionState
  );

  // Client-side countdown tick. The authoritative deadline lives in the
  // database; this only re-renders the label every 30 s so the volunteer
  // sees a live countdown without a page refresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const deadlineMs = new Date(verification.target_deadline).getTime();
  const minutesLeft = Math.max(
    0,
    Math.floor((deadlineMs - now) / 60_000)
  );
  const isUrgent = minutesLeft <= 5;
  const isOverdue = minutesLeft <= 0;

  const success =
    completeState.success ?? escalateState.success ?? null;
  const error = completeState.error ?? escalateState.error ?? null;

  return (
    <Card glass={isUrgent || isOverdue ? false : true}>
      <CardBody className="pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-2xl font-extrabold text-blood-700">
            {verification.blood_group}
          </span>
          <span className="text-base font-semibold text-ink-900">
            {BLOOD_COMPONENT_LABELS[verification.blood_component]} ·{" "}
            {verification.units} {verification.units === 1 ? "unit" : "units"}
          </span>
          <span
            className={cn(
              "rounded-md border px-3 py-1 text-sm font-bold",
              isOverdue
                ? "border-red-300 bg-red-50 text-red-800"
                : isUrgent
                  ? "border-orange-300 bg-orange-50 text-orange-800"
                  : "border-ink-200 bg-ink-100 text-ink-700"
            )}
          >
            {isOverdue
              ? "Overdue"
              : `⏳ ${formatCountdown(minutesLeft)} left`}
          </span>
          <span className="rounded-md border border-ink-200 bg-ink-100 px-3 py-1 text-sm font-bold text-ink-700">
            {URGENCY_LABELS[verification.urgency]}
          </span>
        </div>

        <p className="mt-3 text-lg font-bold text-ink-900">
          {verification.hospital_locality}
        </p>
        <p className="mt-1 text-base text-ink-600">
          Required by {formatDateTime(verification.required_by)} · Verification
          deadline {formatDateTime(verification.target_deadline)}
        </p>

        {isOverdue && (
          <Alert variant="warning" title="Verification overdue" className="mt-4">
            This verification window has passed. Escalate to another volunteer
            or mark the outcome if you have already confirmed.
          </Alert>
        )}

        {success && <Alert variant="success" className="mt-4">{success}</Alert>}
        {error && <Alert variant="error" className="mt-4">{error}</Alert>}

        <div className="mt-5 flex flex-wrap gap-3">
          <form action={completeAction}>
            <input type="hidden" name="requestId" value={verification.request_id} />
            <input type="hidden" name="outcome" value="verified" />
            <Button type="submit" disabled={completePending}>
              {completePending ? "Recording…" : "✓ Verified"}
            </Button>
          </form>
          <form action={completeAction}>
            <input type="hidden" name="requestId" value={verification.request_id} />
            <input type="hidden" name="outcome" value="rejected" />
            <Button type="submit" variant="secondary" disabled={completePending}>
              {completePending ? "Recording…" : "✗ Rejected"}
            </Button>
          </form>
        </div>

        {escalationTargets && escalationTargets.length > 0 && (
          <form
            action={escalateAction}
            className="mt-4 flex flex-wrap items-end gap-3 border-t border-ink-200 pt-4"
          >
            <input type="hidden" name="requestId" value={verification.request_id} />
            <div className="flex-1 min-w-[200px]">
              <label
                htmlFor={`escalate-${verification.id}`}
                className="block text-sm font-bold text-ink-700"
              >
                Escalate to
              </label>
              <select
                id={`escalate-${verification.id}`}
                name="targetVolunteerId"
                className="mt-1 w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-base text-ink-900"
                disabled={escalatePending}
              >
                {escalationTargets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="secondary" disabled={escalatePending}>
              {escalatePending ? "Escalating…" : "Escalate"}
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}