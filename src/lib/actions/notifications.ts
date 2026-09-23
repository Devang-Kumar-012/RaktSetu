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

import { getSessionInfo } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
