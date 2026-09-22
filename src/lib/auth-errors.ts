/**
 * Maps Supabase Auth error messages to safe, human-friendly copy.
 * Never leaks whether an email exists, and never surfaces raw
 * internal errors to users.
 */
export function friendlyAuthError(raw: unknown): string {
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
  return "Something went wrong. Please try again in a moment.";
}
