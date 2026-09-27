/**
 * REGISTRATION FAILURE TAXONOMY — the one place a failed sign-up is named.
 *
 * WHY THIS FILE EXISTS
 *
 * Registration used to answer every server fault with a single string,
 * "signup unavailable", which matched no branch of the error mapper and so
 * reached the screen as "Something went wrong. Please try again in a moment."
 * That is the worst possible outcome: a user is told nothing, an operator cannot
 * tell whether the database was read-only, the email was taken, or the session
 * insert failed, and the real exception was only visible in a log nobody reads.
 *
 * So every failure is CLASSIFIED here, given a short safe sentence, and given an
 * error ID that is printed to the user and written to the server log. The ID is
 * the join between the two: a user can quote it, and it locates the exact
 * failure in the logs without ever exposing one to the other.
 *
 * Two rules hold everywhere this is used:
 *
 *  1. USER COPY IS SAFE BY CONSTRUCTION. Every sentence is written by hand here.
 *     No database message, stack frame, filesystem path or driver code is ever
 *     interpolated into one — so there is no way for one to leak by accident.
 *  2. THERE IS NO GENERIC FALLBACK. An unrecognised failure still produces a
 *     specific sentence naming an error ID, because "we don't know" is only
 *     honest when it is also traceable.
 */

/** Every way creating an account can fail. */
export type RegistrationErrorCode =
  /** The submitted email is not a usable address. */
  | "INVALID_EMAIL"
  /** The password failed the server's own policy check. */
  | "INVALID_PASSWORD"
  /** The name was missing or too short to identify the donor. */
  | "INVALID_NAME"
  /** Any other rejected input. */
  | "VALIDATION_ERROR"
  /** That email already has an account. */
  | "DUPLICATE_ACCOUNT"
  /** No database could be opened at all (runtime or driver problem). */
  | "DATABASE_UNAVAILABLE"
  /** A database was found but its storage cannot be written on this platform. */
  | "DATABASE_NOT_WRITABLE"
  /** The write itself was rejected — constraints, corruption, disk full. */
  | "DATABASE_WRITE_FAILED"
  /** The account row exists but its role membership could not be created. */
  | "ROLE_CREATION_FAILED"
  /** The account exists but the session row could not be created. */
  | "SESSION_CREATION_FAILED"
  /** The session row exists but the browser cookie could not be issued. */
  | "AUTHENTICATION_FAILED"
  /** A caught error the classifier did not recognise. */
  | "UNKNOWN_REGISTRATION_ERROR";

/**
 * A failure that is safe to send to the browser: a category, a safe sentence and
 * a traceable ID. It deliberately carries no error object, so a stack trace
 * cannot ride along on the server-action wire.
 */
export interface RegistrationFailure {
  code: RegistrationErrorCode;
  /** Short, safe, user-facing. Always present. */
  message: string;
  /**
   * `REG-XXXXXX`. Present for every PLATFORM fault, so a log can be located.
   * Absent for the visitor's own input mistakes (a short password), which are
   * not incidents and would only collect meaningless IDs if they had one.
   */
  errorId?: string;
}

const COPY: Record<RegistrationErrorCode, string> = {
  INVALID_EMAIL: "That email address doesn't look right. Please check it and try again.",
  INVALID_PASSWORD: "Please choose a password of at least 8 characters.",
  INVALID_NAME: "Please enter your full name.",
  VALIDATION_ERROR: "Registration failed: the details you entered are not valid.",
  DUPLICATE_ACCOUNT:
    "Registration failed: an account with this email address already exists. Try logging in instead.",
  DATABASE_UNAVAILABLE:
    "Registration failed: the account database is unavailable on this server, so no new account can be created.",
  DATABASE_NOT_WRITABLE:
    "Registration failed: the account database is not writable in the current deployment, so no new account can be created.",
  DATABASE_WRITE_FAILED:
    "Registration failed: the server could not save your account.",
  ROLE_CREATION_FAILED:
    "Registration failed: your account was created but its role could not be assigned, so it cannot be used yet.",
  SESSION_CREATION_FAILED:
    "Registration failed: your account was created but the server could not start your session. Please try logging in.",
  AUTHENTICATION_FAILED:
    "Registration failed: your account was created but the server could not sign you in. Please try logging in.",
  UNKNOWN_REGISTRATION_ERROR:
    "Registration failed: an unexpected server error occurred.",
};

/**
 * A short, collision-resistant reference to ONE failure.
 *
 * Six characters of base32 is ~1e9 combinations, so two failures in the same
 * window will not share an ID, and the ID carries no information about the error.
 */
export function newRegistrationErrorId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `REG-${out}`;
}

/**
 * Node filesystem/driver error codes that mean "this platform cannot give the
 * app a database file", as opposed to "the query was wrong".
 */
const STORAGE_CODES = new Set([
  "EROFS", // read-only filesystem — the deployed serverless bundle
  "EACCES", // permission denied
  "EPERM",
  "ENOSPC", // out of space
  "EMFILE",
  "ENFILE",
]);
const DRIVER_CODES = new Set([
  "ERR_UNKNOWN_BUILTIN_MODULE", // node:sqlite absent — runtime older than 22.13
  "ERR_DLOPEN_FAILED",
]);

/**
 * Turn a thrown value into a category.
 *
 * `context` is the step being attempted, so an error raised while creating the
 * session is not reported as a generic write failure. Unrecognised errors
 * deliberately fall through to UNKNOWN rather than being forced into a
 * friendlier-sounding bucket: a wrong diagnosis is worse than an honest one.
 */
export function classifyRegistrationError(
  err: unknown,
  context: "create-user" | "create-session" | "set-cookie" = "create-user",
): RegistrationErrorCode {
  const e = err as { code?: unknown; message?: unknown; reason?: unknown } | null;

  // Already classified by the storage layer — trust its more specific answer.
  if (e && typeof e === "object" && typeof e.reason === "string") {
    if (e.reason === "storage-read-only" || e.reason === "storage-unwritable") {
      return "DATABASE_NOT_WRITABLE";
    }
    if (e.reason === "sqlite-unavailable" || e.reason === "open-failed") {
      return "DATABASE_UNAVAILABLE";
    }
  }

  const code = typeof e?.code === "string" ? e.code : "";
  const message = typeof e?.message === "string" ? e.message : "";

  if (code === "23505" || /UNIQUE constraint failed/i.test(message)) {
    return "DUPLICATE_ACCOUNT";
  }
  if (DRIVER_CODES.has(code) || /node:sqlite|Cannot find module/i.test(message)) {
    return "DATABASE_UNAVAILABLE";
  }
  if (STORAGE_CODES.has(code)) return "DATABASE_NOT_WRITABLE";
  if (code === "ENOENT") return "DATABASE_UNAVAILABLE";
  if (/SQLITE_CANTOPEN|SQLITE_READONLY|SQLITE_IOERR|SQLITE_CORRUPT|SQLITE_FULL/i.test(message)) {
    return /SQLITE_READONLY/.test(message) ? "DATABASE_NOT_WRITABLE" : "DATABASE_WRITE_FAILED";
  }

  if (context === "create-session") return "SESSION_CREATION_FAILED";
  if (context === "set-cookie") return "AUTHENTICATION_FAILED";
  return "UNKNOWN_REGISTRATION_ERROR";
}

/**
 * Field names whose values must never be logged or returned. Replaced with a
 * marker rather than dropped, so a redaction bug is visible instead of silent.
 */
const SECRET_KEYS = /pass|token|secret|cookie|authorization|hash|salt/i;

/** A log-safe projection of an error: names, codes and short strings only. */
export function safeErrorSummary(err: unknown): Record<string, string> {
  const e = err as Record<string, unknown> | null;
  if (!e || typeof e !== "object") return { detail: String(err).slice(0, 200) };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(e)) {
    if (SECRET_KEYS.test(k)) {
      out[k] = "[redacted]";
    } else if (typeof v === "string") {
      out[k] = v.slice(0, 300);
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = String(v);
    }
  }
  return out;
}


/** Build a failure, generating its ID when one was not supplied. */
export function registrationFailure(
  code: RegistrationErrorCode,
  errorId: string = newRegistrationErrorId(),
): RegistrationFailure {
  return { code, message: COPY[code], errorId };
}

/**
 * The exact sentence the user should see, with the traceable ID appended when
 * there is one. A visitor who mistyped their password gets a clean sentence; a
 * platform fault additionally gets an ID they can quote to support.
 */
export function describeRegistrationFailure(failure: RegistrationFailure): string {
  return failure.errorId
    ? `${failure.message} Error ID: ${failure.errorId}`
    : failure.message;
}

/** True when `value` names a failure category this module knows. */
export function isRegistrationFailure(value: unknown): value is RegistrationFailure {
  if (!value || typeof value !== "object") return false;
  const f = value as Partial<RegistrationFailure>;
  return typeof f.code === "string" && f.code in COPY;
}
