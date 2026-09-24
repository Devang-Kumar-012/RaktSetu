"use server";

/**
 * Server actions for the ONE shared in-app notification centre.
 *
 * Notifications are emitters-only in the database (no INSERT/UPDATE/DELETE
 * grant for clients — migrations 0011/0013); the single thing a user may do is
 * mark THEIR OWN rows read. That is all these actions do:
 *   - every statement is filtered by `user_id = session user` AND backed by the
 *     `notifications_own_mark_read` RLS policy, so marking one recipient's
 *     notification read can never touch another user's copy;
 *   - unread counts are always read from the database, never inferred.
 */
import { revalidatePath } from "next/cache";
import type { ProfileActionState } from "@/lib/actions/action-state";

import { getSessionInfo } from "@/lib/profile";
import { NOTIFICATION_PREFERENCE_KEYS } from "@/lib/constants";
import { createSupabaseServerClient } from "@/lib/supabase/server";


/**
 * Updates the caller's OWN notification preferences.
 *
 * Only the three ADVISORY categories can be touched. There is deliberately no
 * field here for emergency alerts, acceptances, request outcomes or account
 * changes: a user cannot mute the emergency workflow, and nothing in this
 * action (or its form) could ask it to.
 *
 * The id always comes from the session, never the form, and RLS scopes the
 * update to the caller's own row — so this cannot touch another user's choices
 * even if called directly.
 */
export async function updateNotificationPreferences(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const session = await getSessionInfo();
  if (!session.configured || !session.user) {
    return { ok: false, error: "Please log in to change your preferences." };
  }

  // Only known advisory keys are read, and only as an explicit on/off. An
  // unknown or absent checkbox means "off", which is how HTML forms submit
  // unchecked boxes.
  const patch: Record<string, boolean> = {};
  for (const key of NOTIFICATION_PREFERENCE_KEYS) {
    patch[key] = String(formData.get(key) ?? "") === "on";
  }

  const supabase = await createSupabaseServerClient();
  // Upsert: a user who has never opened the preference screen has no row yet.
  const { error: dbError } = await supabase
    .from("notification_preferences")
    .upsert({ user_id: session.user.id, ...patch });

  if (dbError) {
    console.error("updateNotificationPreferences failed:", dbError.message);
    return { ok: false, error: "Could not save your preferences. Please try again." };
  }

  revalidatePath("/profile");
  revalidatePath("/notifications");
  return { ok: true, error: null, success: "Notification preferences saved." };
}

/**
 * Fires the advisory donor reminder sweep (cooldown + unanswered alerts).
 *
 * Idempotent and guarded per donation and per alert, so it is safe to call on
 * every authenticated donor page load. Failures are swallowed deliberately: a
 * reminder sweep must never break the page it rides on, and pg_cron runs the
 * same function independently.
 */
export async function tickDonorReminders(): Promise<void> {
  try {
    const session = await getSessionInfo();
    if (!session.configured || !session.user || !session.profile) return;
    if (session.profile.status !== "active" || session.profile.role !== "donor") return;
    const supabase = await createSupabaseServerClient();
    await supabase.rpc("emit_donor_reminders");
  } catch {
    // Best-effort by design.
  }
}

/** Marks ONE of the caller's own notifications as read (idempotent). */
export async function markNotificationRead(notificationId: number): Promise<void> {
  const session = await getSessionInfo();
  if (!session.configured || !session.user) return;
  if (!Number.isSafeInteger(notificationId) || notificationId <= 0) return;

  const supabase = await createSupabaseServerClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", session.user.id)
    .is("read_at", null);

  revalidatePath("/notifications");
}

/** Marks every one of the caller's in-app notifications as read. */
export async function markAllNotificationsRead(): Promise<void> {
  const session = await getSessionInfo();
  if (!session.configured || !session.user) return;

  const supabase = await createSupabaseServerClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", session.user.id)
    .is("read_at", null);

  revalidatePath("/notifications");
}
