"use client";

import { Alert } from "@/components/ui/Alert";

/**
 * Shown ONLY when the public Supabase URL/anon key are genuinely absent at
 * build or request time.
 *
 * Why this is a component rather than four copies of a string: the previous
 * inline copy told every reader to "add them to .env.local and restart the
 * app". On a deployed Netlify site that advice is actively wrong — there is no
 * local file to edit, so it sent visitors and deployers chasing a fix that
 * cannot work. The message now names the exact variables and the exact place
 * to set them for a deployed site.
 *
 * It deliberately reveals nothing about the project beyond the two PUBLIC
 * variable names. The service-role key is never referenced, here or anywhere
 * in client code.
 */
export function AuthNotConfigured({ action }: { action: string }) {
  return (
    <Alert variant="warning" title="Authentication is unavailable on this deployment">
      <p>
        RaktSetu could not find its Supabase connection settings, so {action} is
        disabled. This is a deployment setting, not something wrong with your
        account.
      </p>
      <p className="mt-3">
        For a deployed site, set these two variables in{" "}
        <strong>Netlify → Site configuration → Environment variables</strong>:
      </p>
      <ul className="mt-2 list-inside list-disc space-y-1">
        <li>
          <code>NEXT_PUBLIC_SUPABASE_URL</code> — your project URL, e.g.{" "}
          <code>https://&lt;project-ref&gt;.supabase.co</code>
        </li>
        <li>
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> — the public anon key
        </li>
      </ul>
      <p className="mt-3">
        Then redeploy. For local development, put the same two values in{" "}
        <code>.env.local</code> and restart the dev server. Both are safe to
        expose: they are public credentials, and every row they can read is
        protected by database access rules.
      </p>
    </Alert>
  );
}
