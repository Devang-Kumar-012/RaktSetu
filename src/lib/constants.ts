/** Shared app constants. */
export const APP_NAME = "RaktSetu";
export const APP_TAGLINE = "A blood donor network for urgent needs.";
export const APP_DESCRIPTION =
  "RaktSetu is a live blood-donor network. When blood is urgently needed, it reaches willing donors nearby — and the patient never has to operate the app themselves.";

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

/** Request abuse reports (migration 0010). */
export const REPORT_REASONS = [
  { value: "fake", label: "Fake or suspicious request" },
  { value: "spam", label: "Spam or repeated posting" },
  { value: "harassment", label: "Harassment or inappropriate content" },
  { value: "other", label: "Something else" },
] as const;

export const REPORT_REASON_LABELS: Record<string, string> = {
  fake: "Fake / suspicious",
  spam: "Spam",
  harassment: "Harassment",
  other: "Other",
};

export const REPORT_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  reviewed: "Reviewed",
  dismissed: "Dismissed",
};

export const REPORT_DETAILS_MAX = 500;

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



