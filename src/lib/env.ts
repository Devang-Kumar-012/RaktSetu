/**
 * App configuration.
 *
 * RaktSetu is self-contained: the data layer runs in the visitor's own browser
 * (see src/lib/local), so there are no Supabase variables, no API keys and no
 * environment setup of any kind. The helpers below are retained only so
 * existing call sites keep compiling, and they never gate the app.
 *
 * The "configured" checks deliberately always report true. Leaving them
 * variable-driven is what previously made every auth screen render
 * "Authentication is not configured" on a deployment without credentials.
 */

/** Always true: the app has no external dependency to be unconfigured about. */
export function isSupabaseConfigured(): boolean {
  return true;
}

/**
 * @deprecated No backend is contacted. Kept so legacy call sites compile.
 * Returns an inert placeholder rather than a real endpoint.
 */
export function getSupabaseUrl(): string {
  return "http://localhost";
}

/**
 * @deprecated No backend is contacted. Kept so legacy call sites compile.
 * Returns an inert placeholder; it authenticates nothing.
 */
export function getSupabaseAnonKey(): string {
  return "local-only-no-backend";
}

/** App-wide metadata. */
export const APP_NAME = "RaktSetu";
export const APP_TAGLINE = "Blood reaches people, not paperwork.";
