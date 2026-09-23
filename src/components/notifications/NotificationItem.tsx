"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { markNotificationRead } from "@/lib/actions/notifications";
import { cn } from "@/lib/cn";
import { notificationKindLabel } from "@/lib/notifications";
import type { NotificationDestination } from "@/lib/notifications";
import { formatDateTime } from "@/lib/utils";
import type { NotificationRow } from "@/types";

/**
 * One row in the shared notification centre — compact by design (a
 * notification is information, not a decorative card): kind label, exact
 * timestamp, title, short message, one destination link, and the per-row
 * "mark as read" control.
 *
 * Unread rows use the blood-tinted glass surface (the documented use for
 * unread notifications) and carry an explicit "Unread" marker, so the state is
 * never colour-only. Every tap target is at least 44 px tall, text wraps instead
 * of overflowing on a narrow screen, and the timestamp is a real <time>
 * element.
 */
export function NotificationItem({
  item,
  destination,
}: {
  item: NotificationRow;
  destination: NotificationDestination | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const unread = item.read_at === null;

  return (
    <li>
      <article
        className={cn(
          "rounded-lg px-4 py-4 sm:px-5",
          unread ? "glass-blood" : "glass"
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm font-bold uppercase tracking-widest text-blood-700">
            {notificationKindLabel(item.kind)}
          </span>
          <time dateTime={item.created_at} className="text-sm text-ink-400">
            {formatDateTime(item.created_at)}
          </time>
          {unread && (
            <span className="rounded bg-blood-700 px-2 py-0.5 text-xs font-bold text-white">
              Unread
            </span>
          )}
        </div>

        <p className="mt-1 break-words text-lg font-bold text-ink-900">
          {item.title}
        </p>
        <p className="mt-1 break-words text-base text-ink-600">{item.body}</p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {destination && (
            <Link
              href={destination.href}
              className="inline-flex min-h-11 items-center rounded-md border border-ink-200 bg-white px-4 text-base font-semibold text-ink-900 hover:bg-ink-100"
            >
              {destination.label} →
            </Link>
          )}
          {unread ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await markNotificationRead(item.id);
                  router.refresh();
                })
              }
            >
              {pending ? "Marking…" : "Mark as read"}
            </Button>
          ) : (
            <span className="text-sm font-semibold text-ink-400">Read</span>
          )}
        </div>
      </article>
    </li>
  );
}
