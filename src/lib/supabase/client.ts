/**
 * Browser-side data client.
 *
 * The app is fully self-contained: data lives in this visitor's own browser,
 * so the client needs no environment variables, no API key and no backend. A
 * deployment with no configuration still works.
 *
 * The return type is deliberately the same shape the rest of the app already
 * consumes, so pages and server actions above this seam are unchanged.
 */
import { createLocalClient, type LocalClient } from "@/lib/local/adapter";

export function createSupabaseBrowserClient(): LocalClient {
  return createLocalClient();
}

