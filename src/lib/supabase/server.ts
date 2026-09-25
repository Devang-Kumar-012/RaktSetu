/**
 * Server-side data client for Server Components, Server Actions and handlers.
 *
 * Previously a Supabase SSR client that threw when the Supabase variables were
 * absent, which is what blocked authentication on deployment. It is now the
 * local adapter: no credentials, no backend, no configuration step.
 *
 * Kept async and under the same name so every existing call site — server
 * actions, pages, route handlers — works untouched.
 */
import { createLocalClient, type LocalClient } from "@/lib/local/adapter";

export async function createSupabaseServerClient(): Promise<LocalClient> {
  return createLocalClient();
}

