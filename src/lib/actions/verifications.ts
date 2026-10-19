"use server";

/**
 * Server actions for volunteer verification of emergency requests (migration 0019).
 *
 * When a donor accepts an emergency alert, a time-boxed verification task is
 * created for the coordinating volunteer. The volunteer must check that the
 * accepted-donor coordination can proceed safely before the deadline. If they
 * cannot, they escalate to another volunteer.
 *
 * Contact release stays exclusively on donor_alerts.contact_shared_until —
 * nothing in this module touches requester contact or donor medical data.
 *
 * Every decision re-runs inside the database functions
 * (start_volunteer_verification, complete_volunteer_verification,
 * escalate_volunteer_verification), so the UI is never the security boundary.
 */
import { revalidatePath } from "next/cache";

import type { ProfileActionState } from "@/lib/actions/action-state";
import { getSessionInfo } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Maps start_volunteer_verification() outcome codes to volunteer-facing messages. */
const START_MESSAGES: Record<string, string> = {
  success: "Verification task started. Check in before the deadline.",
  not_found: "This request no longer exists.",
  already_verified: "This request has already been verified.",
  already_pending: "Another verification is already in progress for this request.",
  volunteer_inactive: "Your volunteer account is not active.",
  requester_inactive: "The requester's account is not active.",
};

/** Maps complete_volunteer_verification() outcome codes to messages. */
const COMPLETE_MESSAGES: Record<string, string> = {
  success_verified: "Verification recorded. The donor's acceptance is confirmed.",
  success_rejected:
    "Verification rejected. The requester will be notified to look for another donor.",
  not_pending:
    "This verification is no longer pending — it may have already been completed or escalated.",
  invalid_outcome: "Choose either Verified or Rejected.",
  not_your_task: "This verification task is assigned to a different volunteer.",
  outcome_mismatch: "The outcome you submitted does not match the action you chose.",
  requester_inactive: "The requester's account is not active.",
  requester_closed: "The request is no longer active.",
};

/** Maps escalate_volunteer_verification() outcome codes to messages. */
const ESCALATE_MESSAGES: Record<string, string> = {
  success: "Verification escalated. Another volunteer has been notified.",
  not_pending: "This verification is no longer pending.",
  invalid_target: "That volunteer cannot receive an escalation.",
  self_target: "You cannot escalate to yourself.",
  not_your_task: "This verification task is assigned to a different volunteer.",
  target_inactive: "That volunteer is not currently active.",
};

function isUuid(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

/**
 * Server-side guard: the caller must be an ACTIVE volunteer.
 */
type VolunteerGuard =
  | { error: string; userId?: undefined }
  | { error?: undefined; userId: string };

async function requireActiveVolunteer(): Promise<VolunteerGuard> {
  const session = await getSessionInfo();
  if (!session.configured || !session.user || !session.profile) {
    return { error: "Please log in as a volunteer to coordinate requests." };
  }
  if (session.profile.role !== "volunteer" || session.profile.status !== "active") {
    return { error: "Only active volunteer accounts can coordinate requests." };
  }
  return { userId: session.user.id };
}

/**
 * Volunteer starts a verification task on an ACTIVE request.
 *
 * Delegates to start_volunteer_verification (migration 0019): atomic, one
 * pending per request (DB-level dedup via partial unique constraint), and
 * failure outcomes are codes only — never requester contact data.
 */
export async function startVerification(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const guard = await requireActiveVolunteer();
  if (guard.error) return { ok: false, error: guard.error };

  const requestId = String(formData.get("requestId") ?? "").trim();
  if (!isUuid(requestId)) {
    return { ok: false, error: "Invalid request reference." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("start_volunteer_verification", {
    p_request_id: requestId,
  });

  if (error) {
    console.error("startVerification failed:", error.message);
    return { ok: false, error: "Could not start verification. Please try again." };
  }

  const outcome = String(data ?? "");
  const message = START_MESSAGES[outcome];
  if (!message) {
    return { ok: false, error: "Unexpected response from the server." };
  }
  if (outcome !== "success") {
    return { ok: false, error: message };
  }

  revalidatePath("/dashboard/volunteer");
  revalidatePath(`/volunteer/requests/${requestId}`);
  return { ok: true, error: null, success: message };
}

/**
 * Volunteer completes (verified / rejected) their OWN pending verification task.
 *
 * Delegates to complete_volunteer_verification (migration 0019): atomic,
 * scoped to the caller's own task, and the outcome is checked against the
 * accepted alert. Success outcomes are success_verified / success_rejected.
 */
export async function completeVerification(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const guard = await requireActiveVolunteer();
  if (guard.error) return { ok: false, error: guard.error };

  const requestId = String(formData.get("requestId") ?? "").trim();
  const outcome = String(formData.get("outcome") ?? "").trim();
  if (!isUuid(requestId)) {
    return { ok: false, error: "Invalid request reference." };
  }
  if (outcome !== "verified" && outcome !== "rejected") {
    return { ok: false, error: COMPLETE_MESSAGES.invalid_outcome };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("complete_volunteer_verification", {
    p_request_id: requestId,
    p_outcome: outcome,
  });

  if (error) {
    console.error("completeVerification failed:", error.message);
    return { ok: false, error: "Could not record verification. Please try again." };
  }

  const code = String(data ?? "");
  const message = COMPLETE_MESSAGES[code];
  if (!message) {
    return { ok: false, error: "Unexpected response from the server." };
  }
  if (!code.startsWith("success_")) {
    return { ok: false, error: message };
  }

  revalidatePath("/dashboard/volunteer");
  revalidatePath(`/volunteer/requests/${requestId}`);
  revalidatePath("/dashboard/requester");
  return { ok: true, error: null, success: message };
}

/**
 * Volunteer escalates their OWN pending verification to another active volunteer.
 *
 * Delegates to escalate_volunteer_verification (migration 0019): atomic,
 * marks the old task escalated and creates a new pending task for the target
 * volunteer inheriting the same deadline. The original volunteer cannot
 * reclaim it (RLS + policy).
 */
export async function escalateVerification(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const guard = await requireActiveVolunteer();
  if (guard.error) return { ok: false, error: guard.error };

  const requestId = String(formData.get("requestId") ?? "").trim();
  const targetVolunteerId = String(formData.get("targetVolunteerId") ?? "").trim();
  if (!isUuid(requestId)) {
    return { ok: false, error: "Invalid request reference." };
  }
  if (!isUuid(targetVolunteerId)) {
    return { ok: false, error: "Invalid volunteer reference." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("escalate_volunteer_verification", {
    p_request_id: requestId,
    p_target_volunteer_id: targetVolunteerId,
  });

  if (error) {
    console.error("escalateVerification failed:", error.message);
    return { ok: false, error: "Could not escalate verification. Please try again." };
  }

  const outcome = String(data ?? "");
  const message = ESCALATE_MESSAGES[outcome];
  if (!message) {
    return { ok: false, error: "Unexpected response from the server." };
  }
  if (outcome !== "success") {
    return { ok: false, error: message };
  }

  revalidatePath("/dashboard/volunteer");
  revalidatePath(`/volunteer/requests/${requestId}`);
  return { ok: true, error: null, success: message };
}