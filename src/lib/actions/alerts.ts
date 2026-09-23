"use server";

/**
 * Server actions for the emergency alert ring: a donor responding to an
 * alert. Server-only — every decision
 * re-runs inside the database (mark_alert_responded locks the request row so
 * the FIRST valid acceptance wins and later attempts get no contact), so the
 * UI is never the security boundary. No external notification providers:
 * everything stays in-app, and the notification centre's own actions live in
 * src/lib/actions/notifications.ts.
 */
import { revalidatePath } from "next/cache";

import type { ProfileActionState } from "@/lib/actions/action-state";
import { getSessionInfo } from "@/lib/profile";
import { tickAlertRings } from "@/lib/ring-engine";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Maps mark_alert_responded() outcome codes to donor-facing messages. */
const OUTCOME_MESSAGES: Record<string, string> = {
  accepted:
    "Thank you — your acceptance was recorded and the requester's contact is now visible on this alert. Blood-bank screening stays the final step.",
  declined: "Recorded — you won't be alerted again for this request.",
  invalid_response: "Choose either Accept or Decline.",
  not_found: "That alert no longer exists.",
  not_your_alert: "This alert belongs to a different donor.",
  already_responded: "You have already responded to this alert.",
  already_taken:
    "Another donor accepted first — this request now has a donor. Thank you anyway.",
  request_closed: "This request is no longer active — no response is needed.",
  alert_expired: "This alert's response window has passed.",
  not_eligible:
    "Your donor availability or donation interval changed — update your profile to help again.",
};

/**
 * Accepts or declines ONE alert on behalf of the signed-in donor.
 * Delegates to mark_alert_responded (migration 0011): atomic,
 * first-valid-acceptance-wins, donor eligibility re-checked at response time,
 * and failure outcomes are codes only — never requester contact data.
 */
export async function respondToAlert(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const session = await getSessionInfo();
  if (!session.configured || !session.user) {
    return { ok: false, error: "Please sign in to respond to an alert." };
  }

  const alertId = Number(formData.get("alertId"));
  const response = String(formData.get("response") ?? "");
  if (!Number.isSafeInteger(alertId) || alertId <= 0) {
    return { ok: false, error: OUTCOME_MESSAGES.not_found };
  }
  if (response !== "accepted" && response !== "declined") {
    return { ok: false, error: OUTCOME_MESSAGES.invalid_response };
  }

  // Keep the engine honest even if pg_cron is unavailable (idempotent).
  await tickAlertRings();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("mark_alert_responded", {
    p_alert_id: alertId,
    p_response: response,
  });

  if (error) {
    return { ok: false, error: "Could not record your response. Please try again." };
  }

  const outcome = String(data ?? "");
  const message = OUTCOME_MESSAGES[outcome];
  if (!message) {
    return { ok: false, error: "Unexpected response from the server." };
  }
  if (outcome !== "accepted" && outcome !== "declined") {
    return { ok: false, error: message };
  }

  revalidatePath("/dashboard/donor");
  revalidatePath("/notifications");
  return { ok: true, error: null, success: message };
}
