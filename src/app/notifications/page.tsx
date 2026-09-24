import { redirect } from "next/navigation";

import { PageHeader, Section } from "@/components/layout/PageHeader";
import { NotificationsLive } from "@/components/notifications/NotificationsLive";
import { Alert } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/States";
import { countUnreadNotifications } from "@/lib/notifications";
import { getUnreadNotificationCount } from "@/lib/notifications-server";
import { getSessionInfo } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { NotificationRow } from "@/types";

export const metadata = { title: "Notifications" };

// Session-gated: render per request so auth is never baked into a static
// prerender, and so new notifications show up on every visit.
export const dynamic = "force-dynamic";

/** Most recent notifications rendered on one visit. */
const PAGE_SIZE = 50;

/**
 * The ONE in-app notification centre — every role, no per-role variant.
 * RaktSetu has NO email/SMS/chat providers: alerts, acceptances, closures,
 * ring completion, volunteer coordination and admin report notices all land
 * here, emitted exclusively by SECURITY DEFINER functions (migrations
 * 0011–0013). Rows are own-row RLS; realtime + focus refresh keep the list
 * current, and every row can be opened, marked read, or — for this recipient
 * only — bulk-marked read.
 *
 * The unread count is asked of the DATABASE (exact count for this user); the
 * rendered slice is only a floor, never the source of truth.
 */
export default async function NotificationsPage() {
  const session = await getSessionInfo();

  if (session.configured && !session.user) {
    redirect("/login?next=/notifications");
  }

  let items: NotificationRow[] = [];
  let unreadCount = 0;

  if (session.configured && session.user) {
    const supabase = await createSupabaseServerClient();
    const [{ data }, databaseUnread] = await Promise.all([
      supabase
        .from("notifications")
        .select(
          "id, user_id, kind, request_id, alert_id, drive_id, dedupe_key, title, body, link, read_at, created_at"
        )
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE),
      getUnreadNotificationCount(session.user.id),
    ]);
    items = (data as NotificationRow[] | null) ?? [];
    // Never under-report: the exact count wins, and the rendered rows cover the
    // (unlikely) case where the count query could not answer.
    unreadCount = Math.max(databaseUnread, countUnreadNotifications(items));
  }

  return (
    <>
      <PageHeader
        eyebrow="Notifications"
        title="Your notification centre"
        description="In-app only — RaktSetu never sends email or SMS. New alerts, acceptances, and request updates appear here, shared by every role."
      />
      <Section className="max-w-3xl">
        {!session.configured ? (
          <Alert variant="warning" title="Supabase is not configured">
            Add your project URL and anon key to .env.local to load
            notifications.
          </Alert>
        ) : items.length === 0 ? (
          <EmptyState
            title="No notifications yet"
            description="When you are alerted about a nearby blood request — or a request you created changes state — it will appear here."
          />
        ) : (
          <NotificationsLive
            items={items}
            unreadCount={unreadCount}
            role={session.profile?.role ?? null}
          />
        )}
      </Section>
    </>
  );
}
