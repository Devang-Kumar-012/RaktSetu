/**
 * Small shared utilities.
 */

/** Truncate a string safely, preserving whole words when possible. */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  return `${slice.slice(0, slice.lastIndexOf(" "))}…`;
}

/** Format a date in a friendly, locale-aware way. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Case-insensitive email format check — basic sanity only, not exhaustive. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

/** Formats an ISO timestamp for display, e.g. "24 Sep 2026, 4:30 pm". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Human-readable gap for deadline countdowns, e.g. "2 days 4 h left",
 * "3 h 12 m left", "under a minute left", or "deadline passed".
 * Deliberately round-numbers only — a deadline is a coordination hint,
 * never a medical guarantee.
 */
export function describeGap(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "deadline passed";
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 1) return "under a minute left";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} day${days === 1 ? "" : "s"}${hours > 0 ? ` ${hours} h` : ""} left`;
  if (hours > 0) return `${hours} h ${minutes} m left`;
  return `${minutes} m left`;
}

