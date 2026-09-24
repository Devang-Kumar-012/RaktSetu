/** Shared app constants. */
import type { ReportStatus } from "@/types";

export const APP_NAME = "RaktSetu";
// Used as the <title> suffix, so it states what the product IS rather than
// marketing it. Deliberately contains no promise of availability or outcomes.
export const APP_TAGLINE = "Real-Time Blood Donation Coordination Platform";
export const APP_DESCRIPTION =
  "RaktSetu coordinates compatible nearby blood donors when an urgent request comes in. It alerts willing donors in expanding distance rings, coordinates a valid acceptance, and keeps donor contact details private until then. It does not screen donors, replace hospitals or blood banks, or guarantee blood availability — final medical decisions stay with qualified professionals.";

export const BLOOD_GROUPS = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
] as const;

export type BloodGroup = (typeof BLOOD_GROUPS)[number];

/** Roles a person can pick during registration. Admin is never offered or accepted. */
export const REGISTER_ROLES = [
  {
    value: "donor",
    label: "Donor",
    description: "I am willing to give blood when someone nearby needs it",
  },
  {
    value: "requester",
    label: "Requester",
    description: "I create blood requests for someone who needs blood",
  },
  {
    value: "volunteer",
    label: "Volunteer",
    description: "I help coordinate and verify requests on the ground",
  },
] as const;

/** Human-friendly labels for every role, including admin (never self-registered). */
/** Availability states for donors and volunteers. */
export const AVAILABILITY_OPTIONS = [
  {
    value: "available",
    label: "Available",
    description: "You can be contacted when a nearby request matches",
  },
  {
    value: "temporarily_unavailable",
    label: "Temporarily unavailable",
    description: "You are paused from matching until you switch back",
  },
] as const;

export const AVAILABILITY_LABELS: Record<string, string> = {
  available: "Available",
  temporarily_unavailable: "Temporarily unavailable",
};

export const ROLE_LABELS: Record<string, string> = {
  donor: "Donor",
  requester: "Requester",
  volunteer: "Volunteer",
  admin: "Administrator",
};

/** Blood component options for blood requests. */
export const BLOOD_COMPONENTS = [
  { value: "whole_blood", label: "Whole Blood" },
  { value: "platelets", label: "Platelets" },
] as const;

export const BLOOD_COMPONENT_LABELS: Record<string, string> = {
  whole_blood: "Whole Blood",
  platelets: "Platelets",
};

/** Request urgency levels. */
export const URGENCY_OPTIONS = [
  {
    value: "routine",
    label: "Routine",
    description: "Needed within days — planned transfusion",
  },
  {
    value: "urgent",
    label: "Urgent",
    description: "Needed within 24 hours",
  },
  {
    value: "critical",
    label: "Critical",
    description: "Needed immediately — surgery or emergency",
  },
] as const;

export const URGENCY_LABELS: Record<string, string> = {
  routine: "Routine",
  urgent: "Urgent",
  critical: "Critical",
};

/** Blood request lifecycle statuses. */
export const REQUEST_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  fulfilled: "Fulfilled",
  expired: "Expired",
  cancelled: "Cancelled",
};

export const REQUEST_STATUS_STYLES: Record<string, string> = {
  active: "bg-blood-50 text-blood-700 border border-blood-200",
  fulfilled: "bg-green-50 text-green-900 border border-green-200",
  expired: "bg-ink-100 text-ink-600 border border-ink-200",
  cancelled: "bg-ink-100 text-ink-600 border border-ink-200",
};

/** Allowed unit range per request. */
export const MIN_UNITS = 1;
export const MAX_UNITS = 10;

/** Max characters for the optional request note. */
export const REQUEST_NOTE_MAX = 500;

export const MAIN_NAV_ITEMS = [
  { href: "/about", label: "About" },
  { href: "/donor", label: "Donate" },
  { href: "/request-blood", label: "Request" },
  { href: "/contact", label: "Help" },
] as const;


/**
 * Donor alert / response system defaults.
 *
 * These are APPLICATION defaults, not medical guidance. The blood bank's
 * screening is always authoritative, and the nearest available donor is always
 * offered first. Timing defaults can be changed here and mirrored in the
 * database in supabase/migrations/0008_alerts.sql.
 */
export const ALERT_RINGS_KM = [3, 7, 15] as const;
export const ALERT_WINDOW_MINUTES = 10;
export const ALERT_DUE_AT_OFFSET_MINUTES = 120;

/** Minutes before due_at at which an open alert receives its ONE "expiring"
 *  in-app nudge. Mirrored by emit_alert_expiring() in migration 0012. */
export const ALERT_EXPIRING_NOTICE_MINUTES = 15;

export const ALERT_RING_LABELS: Record<number, string> = {
  3: "within 3 km",
  7: "within 7 km",
  15: "within 15 km",
};

export const ALERT_STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  sent: "Sent",
  opened: "Opened",
  responded: "Responded",
  expired: "Expired",
};

/** Volunteer coordination (migration 0009). */
export const ASSISTANCE_NOTE_MAX = 300;

export const ASSISTANCE_STATUS_LABELS: Record<string, string> = {
  assisting: "Assisting",
  stopped: "Stopped assisting",
};

/**
 * Request abuse reports (migration 0010, reason set widened by 0014).
 *
 * Deliberately small and factual: a reporter is describing something they
 * observed, not diagnosing anyone. No medical or personal detail is ever
 * collected, and the optional note stays with the moderation queue.
 *
 * `spam` and `harassment` are the legacy 0010 values. They remain valid on
 * historical rows and are still rendered, but they are no longer offered —
 * `abuse_misuse` replaces them for new reports.
 */
export const REPORT_REASONS = [
  { value: "fake", label: "Fake or suspicious request" },
  { value: "incorrect_information", label: "Incorrect information" },
  { value: "no_longer_needed", label: "Request no longer needed" },
  { value: "abuse_misuse", label: "Abuse or misuse" },
  { value: "other", label: "Other" },
] as const;

export const REPORT_REASON_LABELS: Record<string, string> = {
  fake: "Fake / suspicious",
  incorrect_information: "Incorrect information",
  no_longer_needed: "No longer needed",
  abuse_misuse: "Abuse / misuse",
  other: "Other",
  // Legacy 0010 values — still rendered on historical reports.
  spam: "Spam (legacy)",
  harassment: "Harassment (legacy)",
};

/** Moderation states. `under_review` means an admin has picked the report up;
 *  `reviewed` and `dismissed` are the two terminal outcomes. */
export const REPORT_STATUSES = ["open", "under_review", "reviewed", "dismissed"] as const;

export const REPORT_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  under_review: "Under review",
  reviewed: "Reviewed",
  dismissed: "Dismissed",
};

/** Terminal moderation states — these rows no longer show review controls. */
export const RESOLVED_REPORT_STATUSES: ReportStatus[] = ["reviewed", "dismissed"];

export const REPORT_DETAILS_MAX = 500;

/**
 * Anti-abuse limits (migration 0014).
 *
 * The DATABASE is the enforcement point — these bounds only validate what an
 * admin may save into the single `platform_safety_limits` row, and they mirror
 * the CHECK constraints there. Defaults are deliberately generous: the aim is
 * to stop mass spam, never to delay a genuine emergency request.
 */
export const SAFETY_LIMITS_DEFAULTS = {
  maxActiveRequestsPerRequester: 3,
  minRequestIntervalSeconds: 45,
  maxRequestsPerHour: 10,
  maxReportsPerDay: 10,
  maxAlertResponsesPerMinute: 20,
} as const;

/** Admin-editable bounds — identical to the migration 0014 CHECK constraints. */
export const SAFETY_LIMITS_BOUNDS = {
  activeRequests: { min: 1, max: 20 },
  requestIntervalSeconds: { min: 0, max: 3600 },
  requestsPerHour: { min: 1, max: 100 },
  reportsPerDay: { min: 1, max: 100 },
  responsesPerMinute: { min: 1, max: 120 },
} as const;

/** SQLSTATE raised by the 0014 anti-abuse guards, so a limit can be reported
 *  as a clear, honest message instead of a generic failure. */
export const SAFETY_LIMIT_SQLSTATE = "RS001";

/** Campus blood drives (migration 0015). A drive's lifecycle is entirely its
 *  own — it is NOT the blood-request lifecycle, and drives never create or
 *  change a blood request. */
export const DRIVE_STATUS_OPTIONS = [
  { value: "upcoming", label: "Upcoming" },
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export const DRIVE_STATUS_LABELS: Record<string, string> = {
  upcoming: "Upcoming",
  ongoing: "Ongoing",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const DRIVE_STATUS_STYLES: Record<string, string> = {
  upcoming: "bg-blue-50 text-blue-900 border border-blue-200",
  ongoing: "bg-green-50 text-green-900 border border-green-200",
  completed: "bg-ink-100 text-ink-600 border border-ink-200",
  cancelled: "bg-red-50 text-red-900 border border-red-200",
};

export const DRIVE_REGISTRATION_STATUS_LABELS: Record<string, string> = {
  registered: "Registered",
  checked_in: "Checked in",
  participated: "Participated",
  cancelled: "Cancelled",
};

/** Max characters for a drive description / venue-style free text. */
export const DRIVE_TITLE_MAX = 120;
export const DRIVE_ORGANIZER_MAX = 160;
export const DRIVE_DESCRIPTION_MAX = 1000;
export const DRIVE_REGISTRATION_NOTE_MAX = 200;

/** Target-unit bounds, mirroring the migration 0015 CHECK. */
export const DRIVE_TARGET_BOUNDS = { min: 1, max: 5000 } as const;

/**
 * How far ahead the in-app "coming up" reminder looks. Mirrors the pg_cron
 * call in migration 0015 so the application tick and the scheduled sweep cover
 * the same window (and stay idempotent via reminder_sent_at).
 */
export const DRIVE_REMINDER_WINDOW_HOURS = 48;

/**
 * Central operational settings added in migration 0016.
 *
 * These mirror the CHECK constraints on platform_settings exactly, so the admin
 * form can never submit a value the database would reject. Defaults reproduce
 * current RaktSetu behaviour, so an untouched install is unchanged.
 */
export const SETTINGS_DEFAULTS = {
  maxAlertRings: 5,
  cooldownReminderLeadDays: 3,
  donorAlertReminderHours: 24,
  driveReminderWindowHours: 48,
} as const;

export const SETTINGS_0016_BOUNDS = {
  /** A ring count below 1 would stop the engine expanding at all. */
  maxAlertRings: { min: 1, max: 5 },
  cooldownReminderLeadDays: { min: 1, max: 30 },
  donorAlertReminderHours: { min: 1, max: 168 },
  driveReminderWindowHours: { min: 1, max: 168 },
} as const;

/**
 * Advisory notification categories a user may switch off (migration 0016).
 *
 * Deliberately NOT a mute-everything list: emergency alerts, acceptances,
 * request-lifecycle and account notifications are never suppressible, because
 * they ARE the emergency workflow. A user cannot opt out of the thing that
 * saves a life.
 */
export const NOTIFICATION_PREFERENCE_CATEGORIES = [
  {
    key: "drive_updates",
    label: "Campus blood drive updates",
    description: "Registration confirmations, schedule changes and cancellations.",
  },
  {
    key: "donor_reminders",
    label: "Donation reminders",
    description:
      "A nudge when your application-level donation interval is nearly over, or when an alert you were sent is still unanswered.",
  },
  {
    key: "recognition_updates",
    label: "Donation milestones",
    description: "Recognition when a recorded donation reaches a milestone.",
  },
] as const;

export const NOTIFICATION_PREFERENCE_KEYS = [
  "drive_updates",
  "donor_reminders",
  "recognition_updates",
] as const;

/**
 * Donor recognition ladder (migration 0016). Mirrors the SQL `unnest(array[…])`
 * so the UI and the database agree on what a milestone is.
 *
 * Recognition is derived ONLY from completed, recorded donations. It is never
 * based on alerts received, "I can help" responses, requests, or any medical
 * judgement.
 */
export const RECOGNITION_MILESTONES = [1, 3, 5, 10, 25, 50] as const;

/** Platform settings bounds (mirror the database checks in migration 0010). */
export const SETTINGS_BOUNDS = {
  ringMin: 1,
  ringMax: 50,
  windowMin: 1,
  windowMax: 240,
  offsetMin: 15,
  offsetMax: 1440,
  intervalMin: 30,
  intervalMax: 365,
} as const;



