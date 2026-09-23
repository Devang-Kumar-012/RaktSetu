"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileActionState } from "@/lib/actions/action-state";
import { getSessionInfo } from "@/lib/profile";
import { REPORT_REASONS, SETTINGS_BOUNDS } from "@/lib/constants";
import { validateRequestNote } from "@/lib/validation";

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

/** Marks a request report as reviewed or dismissed. Admin-only. */
export async function reviewReport(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const guard = await requireAdmin();
  if (guard.error) return { ok: false, error: guard.error };

  const reportId = String(formData.get("reportId") ?? "").trim();
  const action = String(formData.get("action") ?? "").trim();
  if (!isUuid(reportId)) return { ok: false, error: "Invalid report reference." };
  if (action !== "reviewed" && action !== "dismissed") {
    return { ok: false, error: "Invalid review action." };
  }

  const supabase = await createSupabaseServerClient();
  const { error: dbError } = await supabase
    .from("request_reports")
    .update({ status: action, reviewed_at: new Date().toISOString() })
    .eq("id", reportId);

  if (dbError) {
    console.error("reviewReport failed:", dbError.message);
    return { ok: false, error: "Could not update the report. Please try again." };
  }

  revalidatePath("/admin/reports");
  revalidatePath("/admin");
  return {
    ok: true,
    error: null,
    success: action === "dismissed" ? "Report dismissed." : "Report marked reviewed.",
  };
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
 * Any authenticated active user can report a suspicious/fake blood request.
 * Minimal data: reason + optional short note. Duplicate reports per user and
 * request are prevented by the database unique constraint.
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
  const error = validateRequestNote(details);
  if (error) return { ok: false, error };

  const supabase = await createSupabaseServerClient();
  const { error: dbError } = await supabase.from("request_reports").insert({
    request_id: requestId,
    reporter_id: session.user.id,
    reason,
    details: details === "" ? null : details,
  });

  if (dbError) {
    console.error("submitRequestReport failed:", dbError.message);
    return { ok: false, error: "Could not submit the report. Please try again." };
  }

  return {
    ok: true,
    error: null,
    success: "Thank you — the report has been submitted for review.",
  };
}
