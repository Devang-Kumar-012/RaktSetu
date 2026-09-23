"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { LiveRefresh } from "@/components/notifications/LiveRefresh";
import { NotificationItem } from "@/components/notifications/NotificationItem";
import { Button } from "@/components/ui/Button";
import { markAllNotificationsRead } from "@/lib/actions/notifications";
import { resolveNotificationDestination } from "@/lib/notifications";
import type { NotificationViewerRole } from "@/lib/notifications";
import type { NotificationRow } from "@/types";

/**
 * The ONE in-app notification list for every role (donor, requester,
 * volunteer, admin) — there is no per-role variant. Rows arrive server-
 * rendered and are refreshed by the shared <LiveRefresh /> (focus/visibility
 * plus best-effort realtime INSERTs on `notifications`); the page stays fully
 * usable without a realtime connection.
 *
 * `unreadCount` comes from the DATABASE (an exact count for this recipient),
 * not from the rendered slice, so "mark all as read" is accurate even when
 * more notifications exist than are listed. `role` only decides where a
 * notification may be opened — a recipient is never sent to a page their role
 * cannot read.
 */
export function NotificationsLive({
  items,
  unreadCount,
  role,
}: {
  items: NotificationRow[];
  unreadCount: number;
  role: NotificationViewerRole;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <LiveRefresh />

      <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 sm:px-5">
        <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
          {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
        </p>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          disabled={pending || unreadCount === 0}
          onClick={() =>
            startTransition(async () => {
              await markAllNotificationsRead();
              router.refresh();
            })
          }
        >
          {pending ? "Marking…" : "Mark all as read"}
        </Button>
      </div>

      <ul className="mt-6 space-y-4">
        {items.map((item) => (
          <NotificationItem
            key={item.id}
            item={item}
            destination={resolveNotificationDestination(item, role)}
          />
        ))}
      </ul>

      <p className="mt-6 text-sm text-ink-400">
        Showing your {items.length} most recent{" "}
        {items.length === 1 ? "notification" : "notifications"}
        {unreadCount > items.length ? ` · ${unreadCount} unread in total` : ""}.
        Notifications you have read are removed automatically after a
        retention window; unread ones never are.
      </p>
    </div>
  );
}
