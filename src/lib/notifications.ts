/**
 * The ONE notification model shared by every role.
 *
 * RaktSetu has a single in-app notification centre (`/notifications`) and a
 * single set of database emitters (migrations 0011–0013) — there is no
 * per-role notification implementation and no email/SMS/chat provider.
 *
 * This module is deliberately PURE (no Supabase client, no React): the same
 * rules drive the notification centre, the shell unread badge, and the offline
 * checks in scripts/check-rings.ts. Everything user-visible about a
 * notification is decided here:
 *   - the human label for each database kind;
 *   - where a notification may be opened, resolved per viewer role, so a
 *     recipient is never sent to a page their RLS role cannot read;
 *   - read/unread bookkeeping that mirrors the row's own `read_at`.
 *
 * A notification is only ever routed to an EXISTING page: the requester's
 * `/requests/[id]`, the donor dashboard, the volunteer request page, or the
 * admin console. No notification-specific detail page is created.
 */
import type { NotificationRow } from "@/types";

/** Viewer role used for routing; null when the profile is unavailable. */
export type NotificationViewerRole =
  | "donor"
  | "requester"
  | "volunteer"
  | "admin"
  | null
  | undefined;

/** The minimal row shape the resolver needs (keeps it usable offline). */
export type NotificationLike = Pick<
  NotificationRow,
  "kind" | "request_id" | "alert_id" | "link" | "drive_id"
>;

/** Human labels, one per database kind (mirrors notifications_kind_check). */
export const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  // donor: emergency alerts
  alert_received: "New alert",
  alert_expiring: "Respond soon",
  already_accepted: "Already claimed",
  // shared lifecycle (donor + requester)
  request_closed: "Request closed",
  request_fulfilled: "Request fulfilled",
  request_cancelled: "Request cancelled",
  request_expired: "Request expired",
  // requester
  request_created: "Request live",
  donor_accepted: "Donor accepted",
  rings_exhausted: "Rings completed",
  // donor: eligibility
  eligibility_updated: "Eligibility updated",
  acceptance_confirmed: "Acceptance confirmed",
  account_status_changed: "Account update",
  // volunteer: coordination
  volunteer_request_nearby: "Request near you",
  assisted_request_accepted: "Assisted request — donor found",
  assisted_request_fulfilled: "Assisted request fulfilled",
  assisted_request_cancelled: "Assisted request cancelled",
  assisted_request_expired: "Assisted request expired",
  // admin: operations
  admin_report_received: "Report to review",
  // 0015: campus blood drives (in-app only)
  drive_registered: "Drive registered",
  drive_upcoming_reminder: "Drive coming up",
  drive_updated: "Drive update",
  drive_completed: "Drive completed",
};

/** Every kind the database accepts — kept in sync with migration 0013. */
export const NOTIFICATION_KINDS = [
  "alert_received",
  "alert_expiring",
  "already_accepted",
  "request_closed",
  "request_fulfilled",
  "request_cancelled",
  "request_expired",
  "request_created",
  "donor_accepted",
  "rings_exhausted",
  "eligibility_updated",
  "acceptance_confirmed",
  "account_status_changed",
  "volunteer_request_nearby",
  "assisted_request_accepted",
  "assisted_request_fulfilled",
  "assisted_request_cancelled",
  "assisted_request_expired",
  "admin_report_received",
  // 0015: campus blood drives (in-app only)
  "drive_registered",
  "drive_upcoming_reminder",
  "drive_updated",
  "drive_completed",
] as const;

export function notificationKindLabel(kind: string): string {
  return NOTIFICATION_KIND_LABELS[kind] ?? "Update";
}

/** A destination is only offered when a real, role-appropriate page exists. */
export interface NotificationDestination {
  href: string;
  /** Short, action-oriented link text, e.g. "Open request". */
  label: string;
}

/** Request-scoped kinds whose home page is the requester's own request page. */
const REQUESTER_REQUEST_KINDS = new Set<string>([
  "request_created",
  "donor_accepted",
  "rings_exhausted",
  "request_fulfilled",
  "request_cancelled",
  "request_expired",
]);

/** Request-scoped kinds shown to volunteers on the volunteer request page. */
const VOLUNTEER_REQUEST_KINDS = new Set<string>([
  "volunteer_request_nearby",
  "assisted_request_accepted",
  "assisted_request_fulfilled",
  "assisted_request_cancelled",
  "assisted_request_expired",
]);

/** Alerts the donor can still act on — the dashboard renders an anchor per row. */
const DONOR_OPEN_ALERT_KINDS = new Set<string>([
  "alert_received",
  "alert_expiring",
]);

/** 0015: campus-drive kinds. All of them are about ONE drive, so they all
 *  resolve to that drive's own page. Kept as an explicit set rather than an
 *  `if (kind.startsWith("drive_"))` so a future kind cannot silently inherit
 *  a destination it was not designed for. */
const DRIVE_KINDS = new Set<string>([
  "drive_registered",
  "drive_upcoming_reminder",
  "drive_updated",
  "drive_completed",
]);

/**
 * Stored links come from the database (NOT NULL-checked against a path-only
 * regular expression in migration 0011). Re-validated here so a client can
 * never be handed an off-site or malformed target.
 */
const SAFE_STORED_LINK = /^\/[A-Za-z0-9/_-]*(#[A-Za-z0-9_-]+)?$/;

function storedDestination(link: string | null): NotificationDestination | null {
  if (!link || !SAFE_STORED_LINK.test(link)) return null;
  return { href: link, label: "Open" };
}

/**
 * Resolves where tapping a notification should go — or null when it has no
 * destination (an eligibility notice, for example, is informational).
 *
 * The viewer's role decides the target, so a notification can never point a
 * role at a page it cannot read. Closed or expired references degrade to the
 * role's list page, which keeps working (and explains the outcome) even when
 * the specific card is no longer rendered.
 */
export function resolveNotificationDestination(
  notification: NotificationLike,
  role: NotificationViewerRole
): NotificationDestination | null {
  const requestId = notification.request_id;
  const alertId = notification.alert_id;
  const kind = notification.kind;

  // Account notices belong to the existing profile page for every role —
  // they must never fall through to a role dashboard.
  if (kind === "account_status_changed") {
    return { href: "/profile", label: "Open profile" };
  }

  // Campus drives (0015). Every drive event is about one drive, and every role
  // that can receive one (a donor, or an admin/volunteer managing drives) can
  // legitimately open that drive. A requester is never a drive recipient, so
  // that role gets no drive destination rather than a link to an unusable page.
  if (DRIVE_KINDS.has(kind)) {
    if (notification.drive_id && role !== "requester") {
      return { href: `/drives/${notification.drive_id}`, label: "Open drive" };
    }
    return role === "admin" ? { href: "/admin/drives", label: "Open drives" } : null;
  }

  if (role === "admin") {
    if (kind === "admin_report_received") {
      return { href: "/admin/reports", label: "Open reports queue" };
    }
    if (alertId !== null && DONOR_OPEN_ALERT_KINDS.has(kind)) {
      return { href: "/admin/alerts", label: "Open alert monitor" };
    }
    if (requestId) return { href: "/admin/requests", label: "Open requests" };
  }

  if (role === "volunteer" && requestId && VOLUNTEER_REQUEST_KINDS.has(kind)) {
    return { href: `/volunteer/requests/${requestId}`, label: "Open request" };
  }

  if (role === "requester" && requestId && REQUESTER_REQUEST_KINDS.has(kind)) {
    return { href: `/requests/${requestId}`, label: "Open request" };
  }

  if (role === "donor") {
    if (alertId !== null && DONOR_OPEN_ALERT_KINDS.has(kind)) {
      // Deep link to the donor's own alert card when it is still actionable.
      return { href: `/dashboard/donor#alert-${alertId}`, label: "Open alerts" };
    }
    if (kind === "acceptance_confirmed" && alertId !== null) {
      // Post-acceptance confirmation: the alert card is closed, but the anchor
      // still lands the donor on their own accepted record.
      return { href: `/dashboard/donor#alert-${alertId}`, label: "Open alerts" };
    }
    return { href: "/dashboard/donor", label: "Open donor dashboard" };
  }

  // Unknown viewer (profile not loaded yet): fall back to the stored,
  // database-validated link rather than guessing a role page.
  return storedDestination(notification.link);
}

/** Unread = the recipient has not marked this row read yet (per-row state). */
export function isNotificationUnread(
  notification: Pick<NotificationRow, "read_at">
): boolean {
  return notification.read_at === null;
}

/** Count of unread rows in a rendered page of notifications. */
export function countUnreadNotifications(
  items: readonly Pick<NotificationRow, "read_at">[]
): number {
  return items.filter(isNotificationUnread).length;
}

