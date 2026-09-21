/** Shared app constants. */
export const APP_NAME = "RaktSetu";
export const APP_TAGLINE = "Blood reaches people, not paperwork.";
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

/** Primary navigation shown in the header for everyone. */
export const MAIN_NAV_ITEMS = [
  { href: "/about", label: "About" },
  { href: "/donor", label: "Donate" },
  { href: "/request-blood", label: "Request" },
  { href: "/contact", label: "Help" },
] as const;
