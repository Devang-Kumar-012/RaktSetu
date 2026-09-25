/**
 * Browser-side data client.
 *
 * This used to be a Supabase client gated on NEXT_PUBLIC_SUPABASE_* variables,
 * which left every auth screen showing "Authentication is not configured" on a
 * deployment without them. The app is now self-contained, so the client is the
 * local adapter and needs no environment variables, no API key and no backend.
 *
 * The return type is deliberately the same shape the rest of the app already
 * consumes, so pages and server actions above this seam are unchanged.
 */
import { createLocalClient, type LocalClient } from "@/lib/local/adapter";

export function createSupabaseBrowserClient(): LocalClient {
  return createLocalClient();
}

