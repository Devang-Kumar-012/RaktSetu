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

