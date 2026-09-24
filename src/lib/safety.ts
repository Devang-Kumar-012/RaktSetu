/**
 * Interprets errors raised by the platform-safety guards (migration 0014).
 *
 * The anti-abuse guards live in the DATABASE, which is the only place they can
 * actually be enforced — a server action or a UI check can be bypassed by
 * calling PostgREST directly. The cost of that correctness is that a limit
 * arrives back as a raw driver error, so it is translated here ONCE into an
 * honest, plain-language message instead of being reported to the user as a
 * generic "something went wrong".
 *
 * The database already composes a full, human sentence (including the advice
 * to contact a blood bank directly for a genuine emergency), so that text is
 * surfaced verbatim rather than re-invented in the UI.
 */
import { SAFETY_LIMIT_SQLSTATE } from "@/lib/constants";

const LIMIT_MARKER = "RakSetu limit:";

/** Minimal shape of a Supabase/PostgREST error that these guards can produce. */
export interface DatabaseErrorLike {
  code?: string | null;
  message?: string | null;
}

/** True when the failure was an anti-abuse limit, not a real fault. */
export function isSafetyLimitError(
  error: DatabaseErrorLike | null | undefined
): boolean {
  if (!error) return false;
  if (error.code === SAFETY_LIMIT_SQLSTATE) return true;
  return typeof error.message === "string" && error.message.includes(LIMIT_MARKER);
}

/**
 * The database's own limit message, or null when this was not a limit error.
 * Stripping everything before the marker removes the driver/constraint noise
 * PostgREST prepends (e.g. duplicate-key details).
 */
export function safetyLimitMessage(
  error: DatabaseErrorLike | null | undefined
): string | null {
  if (!isSafetyLimitError(error)) return null;
  const message = error?.message ?? "";
  const at = message.indexOf(LIMIT_MARKER);
  return at === -1 ? null : message.slice(at).trim();
}

/** PostgreSQL unique-violation SQLSTATE, used for the one-report-per-pair rule. */
export const UNIQUE_VIOLATION = "23505";
