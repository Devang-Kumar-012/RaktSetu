/**
 * Environment variable handling.
 *
 * Public (browser-exposed) variables are validated on first access.
 * Any Supabase service-role key must NEVER be referenced here or in
 * client code — this application intentionally only uses the anon key.
 */

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const rawAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * True when Supabase environment variables are configured.
 * The app renders in a limited "not configured" state when false,
 * instead of crashing at import time.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(rawUrl && rawAnonKey);
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable: ${name}. ` +
      `Copy .env.example to .env.local and set it.`
    );
  }
  return value;
}

/** Validated Supabase project URL. Throws when missing/invalid. */
export function getSupabaseUrl(): string {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL", rawUrl);
  if (!/^https?:\/\//.test(url)) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid http(s) URL.");
  }
  return url.replace(/\/+$/, "");
}

/** Validated Supabase anon key. Throws when missing. */
export function getSupabaseAnonKey(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", rawAnonKey);
}

/** App-wide metadata. */
export const APP_NAME = "RaktSetu";
export const APP_TAGLINE = "Blood reaches people, not paperwork.";
