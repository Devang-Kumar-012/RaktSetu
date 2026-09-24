"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileActionState } from "@/lib/actions/action-state";
import { getSessionInfo } from "@/lib/profile";
import { REPORT_REASONS, SAFETY_LIMITS_BOUNDS, SETTINGS_BOUNDS } from "@/lib/constants";
import { UNIQUE_VIOLATION, safetyLimitMessage } from "@/lib/safety";
import { validateReportDetails, validateRequestNote } from "@/lib/validation";

function isUuid(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

/**
 * Hard server-side admin guard. The role ALWAYS comes from the database
 * profile of the session user — never from a form field or header.
 * RLS policies (is_current_user_admin) enforce the same rule in SQL.
 */
async function requireAdmin(): Promise<
  { error: string; userId?: undefined } | { error?: undefined; userId: string }
> {
  const session = await getSessionInfo();
  if (!session.configured || !session.user || !session.profile) {
    return { error: "Please log in first." };
  }
  if (session.profile.role !== "admin" || session.profile.status !== "active") {
    return { error: "Only active administrator accounts can do this." };
  }
  return { userId: session.user.id };
}

/**
 * Activates or suspends a user account. Admin-only, and an admin can never
 * change their own status (RLS enforces `id <> auth.uid()` as well) so a
 * single remaining admin cannot lock themselves out.
 */
export async function setUserStatus(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const guard = await requireAdmin();
  if (guard.error) return { ok: false, error: guard.error };

  const userId = String(formData.get("userId") ?? "").trim();
  const nextStatus = String(formData.get("nextStatus") ?? "").trim();
  if (!isUuid(userId)) return { ok: false, error: "Invalid account reference." };
  if (nextStatus !== "active" && nextStatus !== "suspended") {
    return { ok: false, error: "Invalid account status." };
  }
  if (userId === guard.userId) {
    return { ok: false, error: "You cannot change your own account status." };
  }

  const supabase = await createSupabaseServerClient();
  const { error: dbError } = await supabase
    .from("profiles")
    .update({ status: nextStatus })
    .eq("id", userId);

  if (dbError) {
    console.error("setUserStatus failed:", dbError.message);
    return { ok: false, error: "Could not update the account. Please try again." };
  }

  revalidatePath("/admin/users");
  revalidatePath("/admin");
  return {
    ok: true,
    error: null,
    success: nextStatus === "suspended" ? "Account suspended." : "Account activated.",
  };
}

/** Moderation transitions an admin may apply. `under_review` records that an
 *  admin has picked the report up; `reviewed` and `dismissed` are terminal. */
const REVIEW_ACTIONS = ["under_review", "reviewed", "dismissed"] as const;
type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/**
 * Moves ONE report between moderation states. Admin-only: the role is read
 * from the database profile of the session user, never from the form, and the
 * 0014 column-limited UPDATE grant plus the "Admins can review reports" policy
 * are both enforced underneath.
 *
 * The report's moderation state is deliberately the ONLY thing this touches —
 * reporting or resolving a report never alters blood_requests.status.
 */
export async function reviewReport(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const guard = await requireAdmin();
  if (guard.error) return { ok: false, error: guard.error };

  const reportId = String(formData.get("reportId") ?? "").trim();
  const action = String(formData.get("action") ?? "").trim();
  if (!isUuid(reportId)) return { ok: false, error: "Invalid report reference." };
  if (!(REVIEW_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, error: "Invalid review action." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error: dbError } = await supabase
    .from("request_reports")
    .update({ status: action })
    .eq("id", reportId)
    .select("id")
    .maybeSingle();

  if (dbError) {
    console.error("reviewReport failed:", dbError.message);
    return { ok: false, error: "Could not update the report. Please try again." };
  }
  // Zero rows means the row vanished or the admin-only policy denied it — the
  // message stays deliberately vague rather than confirming the row exists.
  if (!data) {
    return { ok: false, error: "That report could not be updated. Refresh and try again." };
  }

  revalidatePath("/admin/reports");
  revalidatePath("/admin");
  const messages: Record<ReviewAction, string> = {
    under_review: "Marked as under review.",
    reviewed: "Marked reviewed.",
    dismissed: "Report dismissed.",
  };
  return { ok: true, error: null, success: messages[action as ReviewAction] };
}

/**
 * Updates the application coordination settings. Every value is re-validated
 * server-side against the same bounds the database checks enforce. These are
 * coordination rules — never medical decisions.
 */
export async function updatePlatformSettings(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const guard = await requireAdmin();
  if (guard.error) return { ok: false, error: guard.error };

  const ringsRaw = String(formData.get("alertRings") ?? "").trim();
  const rings = ringsRaw
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isInteger(v));
  if (rings.length < 1 || rings.length > 5) {
    return { ok: false, error: "Provide 1 to 5 ring distances, comma separated." };
  }
  for (const ring of rings) {
    if (ring < SETTINGS_BOUNDS.ringMin || ring > SETTINGS_BOUNDS.ringMax) {
      return {
        ok: false,
        error: `Ring distances must be between ${SETTINGS_BOUNDS.ringMin} and ${SETTINGS_BOUNDS.ringMax} km.`,
      };
    }
  }

  const windowMinutes = Number(formData.get("alertWindowMinutes"));
  const offsetMinutes = Number(formData.get("alertDueAtOffsetMinutes"));
  const intervalDays = Number(formData.get("donationIntervalDays"));

  if (
    !Number.isInteger(windowMinutes) ||
    windowMinutes < SETTINGS_BOUNDS.windowMin ||
    windowMinutes > SETTINGS_BOUNDS.windowMax
  ) {
    return {
      ok: false,
      error: `Ring wait window must be between ${SETTINGS_BOUNDS.windowMin} and ${SETTINGS_BOUNDS.windowMax} minutes.`,
    };
  }
  if (
    !Number.isInteger(offsetMinutes) ||
    offsetMinutes < SETTINGS_BOUNDS.offsetMin ||
    offsetMinutes > SETTINGS_BOUNDS.offsetMax
  ) {
    return {
      ok: false,
      error: `Alert due-at offset must be between ${SETTINGS_BOUNDS.offsetMin} and ${SETTINGS_BOUNDS.offsetMax} minutes.`,
    };
  }
  if (
    !Number.isInteger(intervalDays) ||
    intervalDays < SETTINGS_BOUNDS.intervalMin ||
    intervalDays > SETTINGS_BOUNDS.intervalMax
  ) {
    return {
      ok: false,
      error: `Donation interval must be between ${SETTINGS_BOUNDS.intervalMin} and ${SETTINGS_BOUNDS.intervalMax} days.`,
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error: dbError } = await supabase
    .from("platform_settings")
    .update({
      alert_rings_km: rings,
      alert_window_minutes: windowMinutes,
      alert_due_at_offset_minutes: offsetMinutes,
      donation_interval_days: intervalDays,
    })
    .eq("id", 1);

  if (dbError) {
    console.error("updatePlatformSettings failed:", dbError.message);
    return { ok: false, error: "Could not save the settings. Please try again." };
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin");
  return { ok: true, error: null, success: "Platform settings saved." };
}

/**
 * Updates the anti-abuse limits in the single platform_safety_limits row.
 *
 * Admin-only, and every value is re-validated here against the SAME bounds the
 * database CHECK constraints enforce, so the form can never store a value the
 * database would reject. These are coordination/abuse guards, never medical
 * rules, and the defaults are deliberately high enough not to block a genuine
 * emergency — changing them is an explicit admin decision.
 */
export async function updateSafetyLimits(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const guard = await requireAdmin();
  if (guard.error) return { ok: false, error: guard.error };

  const B = SAFETY_LIMITS_BOUNDS;
  const read = (field: string, min: number, max: number): number | string => {
    const value = Number(formData.get(field));
    if (!Number.isInteger(value) || value < min || value > max) {
      return `Each safety limit must be a whole number between ${min} and ${max}.`;
    }
    return value;
  };

  const maxActive = read(
    "maxActiveRequestsPerRequester",
    B.activeRequests.min,
    B.activeRequests.max
  );
  if (typeof maxActive === "string") return { ok: false, error: maxActive };
  const minInterval = read(
    "minRequestIntervalSeconds",
    B.requestIntervalSeconds.min,
    B.requestIntervalSeconds.max
  );
  if (typeof minInterval === "string") return { ok: false, error: minInterval };
  const perHour = read("maxRequestsPerHour", B.requestsPerHour.min, B.requestsPerHour.max);
  if (typeof perHour === "string") return { ok: false, error: perHour };
  const reportsPerDay = read("maxReportsPerDay", B.reportsPerDay.min, B.reportsPerDay.max);
  if (typeof reportsPerDay === "string") return { ok: false, error: reportsPerDay };
  const responses = read(
    "maxAlertResponsesPerMinute",
    B.responsesPerMinute.min,
    B.responsesPerMinute.max
  );
  if (typeof responses === "string") return { ok: false, error: responses };

  const supabase = await createSupabaseServerClient();
  const { error: dbError } = await supabase
    .from("platform_safety_limits")
    .update({
      max_active_requests_per_requester: maxActive,
      min_request_interval_seconds: minInterval,
      max_requests_per_hour: perHour,
      max_reports_per_day: reportsPerDay,
      max_alert_responses_per_minute: responses,
    })
    .eq("id", 1);

  if (dbError) {
    console.error("updateSafetyLimits failed:", dbError.message);
    return { ok: false, error: "Could not save the safety limits. Please try again." };
  }

  revalidatePath("/admin/settings");
  return { ok: true, error: null, success: "Safety limits saved." };
}

/**
 * Records a completed donation (administration data — who donated for which
 * request, when, how many units). Admin-only via RLS; never medical data.
 */
export async function recordDonation(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const guard = await requireAdmin();
  if (guard.error) return { ok: false, error: guard.error };

  const donorId = String(formData.get("donorId") ?? "").trim();
  const requestRaw = String(formData.get("requestId") ?? "").trim();
  const donatedOn = String(formData.get("donatedOn") ?? "").trim();
  const unitsRaw = String(formData.get("units") ?? "").trim();

  if (!isUuid(donorId)) return { ok: false, error: "Invalid donor reference." };
  if (requestRaw !== "" && !isUuid(requestRaw)) {
    return { ok: false, error: "Invalid request reference." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(donatedOn) || Number.isNaN(Date.parse(`${donatedOn}T00:00:00Z`))) {
    return { ok: false, error: "Please provide a valid donation date." };
  }
  if (donatedOn > new Date().toISOString().slice(0, 10)) {
    return { ok: false, error: "The donation date cannot be in the future." };
  }
  const units = Number(unitsRaw);
  if (!Number.isInteger(units) || units < 1 || units > 10) {
    return { ok: false, error: "Units must be between 1 and 10." };
  }

  const supabase = await createSupabaseServerClient();
  const { error: dbError } = await supabase.from("donation_history").insert({
    donor_id: donorId,
    request_id: requestRaw === "" ? null : requestRaw,
    donated_on: donatedOn,
    units,
  });

  if (dbError) {
    console.error("recordDonation failed:", dbError.message);
    return { ok: false, error: "Could not record the donation. Please try again." };
  }

  revalidatePath("/admin");
  return { ok: true, error: null, success: "Donation recorded." };
}

/**
 * Any authenticated ACTIVE user can report a suspicious or incorrect blood
 * request. Minimal data only: a reason from the controlled set plus an optional
 * short note. No medical detail and no contact information is ever collected.
 *
 * Duplicate protection is a DATABASE invariant, not a UI trick: the
 * request_reports_unique constraint (request_id, reporter_id) makes a second
 * report from the same person impossible, and the 0014 guard caps how many
 * reports one person may file per day. Both are surfaced here as honest
 * messages rather than a generic failure.
 *
 * Reporting NEVER touches blood_requests — the request keeps its own lifecycle
 * state and stays visible and active. Moderation is entirely separate.
 */
export async function submitRequestReport(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const session = await getSessionInfo();
  if (!session.configured || !session.user || !session.profile) {
    return { ok: false, error: "Please log in to submit a report." };
  }
  if (session.profile.status !== "active") {
    return { ok: false, error: "Only active accounts can submit reports." };
  }

  const requestId = String(formData.get("requestId") ?? "").trim();
  if (!isUuid(requestId)) return { ok: false, error: "Invalid request reference." };

  const reason = String(formData.get("reason") ?? "").trim();
  if (!(REPORT_REASONS as readonly { value: string }[]).some((r) => r.value === reason)) {
    return { ok: false, error: "Please choose a reason for the report." };
  }

  const details = String(formData.get("details") ?? "").trim();
  const detailError = validateReportDetails(details);
  if (detailError) return { ok: false, error: detailError };

  const supabase = await createSupabaseServerClient();

  // Own-row RLS means this can only ever see the CALLER's own reports, so it
  // doubles as a duplicate check and can never reveal that someone else
  // reported the same request.
  const { data: existing } = await supabase
    .from("request_reports")
    .select("id")
    .eq("request_id", requestId)
    .eq("reporter_id", session.user.id)
    .maybeSingle();
  if (existing) {
    return {
      ok: false,
      error: "You have already reported this request. An administrator will review it.",
    };
  }

  const { error: dbError } = await supabase.from("request_reports").insert({
    request_id: requestId,
    reporter_id: session.user.id,
    reason,
    details: details === "" ? null : details,
  });

  if (dbError) {
    // Lost a race with a concurrent submission, or the daily cap was reached.
    if (dbError.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "You have already reported this request. An administrator will review it.",
      };
    }
    const limited = safetyLimitMessage(dbError);
    if (limited) return { ok: false, error: limited };
    console.error("submitRequestReport failed:", dbError.message);
    return { ok: false, error: "Could not submit the report. Please try again." };
  }

  revalidatePath("/admin/reports");
  revalidatePath("/admin");
  return {
    ok: true,
    error: null,
    success: "Thank you — the report has been sent for admin review.",
  };
}
