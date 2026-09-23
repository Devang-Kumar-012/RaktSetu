/**
 * Server-side notification reads that must go to the DATABASE (never derived
 * from a rendered list). Kept separate from `src/lib/notifications.ts` because
 * that module is imported by client components — it stays free of any Supabase
 * server import.
 */
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Exact unread count for one recipient, straight from the database.
 *
 * `notifications` rows are per-recipient (each emitter fans out one row per
 * user), so this count is that user's own read state and nothing else. Backed
 * by the partial index `notifications_unread_idx` (migration 0013). Never
 * throws: a shell badge must not be able to break a page.
 */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  if (!userId) return 0;
  try {
    const supabase = await createSupabaseServerClient();
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}
