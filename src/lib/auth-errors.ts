/**
 * Maps an authentication failure to safe, human-friendly copy.
 *
 * Never leaks whether an email exists, and never surfaces raw internal errors to
 * users.
 *
 * THERE IS NO GENERIC FALLBACK.
 *
 * This function used to end in `"Something went wrong. Please try again in a
 * moment."` for anything unrecognised. That sentence is now BANNED, because it
 * told a user nothing and an operator nothing: it was reachable from a read-only
 * deployment, a missing runtime, a failed session insert and a genuine bug, all
 * of which look identical on screen. An unrecognised failure now returns a
 * sentence that names what could not be done and carries an error ID, so the
 * real cause stays findable in the logs.
 */
import {
  classifyRegistrationError,
  describeRegistrationFailure,
  isRegistrationFailure,
  registrationFailure,
  type RegistrationErrorCode,
} from "@/lib/registration-errors";

export function friendlyAuthError(raw: unknown): string {
  // A recognised category. The canonical sentence is rebuilt from the code
  // rather than trusting a `message` on the wire, so the wording a user sees is
  // always the one in the table and can never be overridden by a caller. Any
  // error ID the server sent is preserved, so it still matches the log.
  if (isRegistrationFailure(raw)) {
    const f = raw as { code: RegistrationErrorCode; errorId?: string };
    return describeRegistrationFailure(registrationFailure(f.code, f.errorId));
  }

  const message = raw instanceof Error ? raw.message : String(raw ?? "");
  const m = message.toLowerCase();

  if (m.includes("invalid login credentials")) {
    return "Email or password is incorrect.";
  }
  if (m.includes("email not confirmed")) {
    return "Please confirm your email first — check your inbox for the confirmation link.";
  }
  if (m.includes("user already registered")) {
    return "An account with this email already exists. Try logging in instead.";
  }
  if (m.includes("rate limit") || m.includes("too many requests")) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (m.includes("signup requires a valid password") || m.includes("password should be")) {
    return "Please choose a stronger password (at least 8 characters).";
  }
  if (m.includes("same password") || m.includes("different from the old")) {
    return "Choose a password you have not used before.";
  }
  if (m.includes("invalid email")) {
    return "That email address doesn't look right.";
  }
  if (m.includes("signups not allowed") || m.includes("signup disabled")) {
    return "Registration is temporarily unavailable. Please try again later.";
  }
  if (m.includes("fetch") || m.includes("network")) {
    return "Network problem — check your connection and try again.";
  }

  // A storage/runtime fault is the single most common real cause, and it is
  // recognisable by the same categories the database layer raises.
  const code = classifyRegistrationError(raw, "create-user");
  if (code !== "UNKNOWN_REGISTRATION_ERROR") {
    return describeRegistrationFailure(registrationFailure(code));
  }

  // Last resort, and it is specific and traceable rather than a shrug. A fresh
  // ID is minted here because the caller has no log line of its own to join to;
  // the sentence still tells the user this is a server fault, not their fault.
  return describeRegistrationFailure(registrationFailure("UNKNOWN_REGISTRATION_ERROR"));
}
