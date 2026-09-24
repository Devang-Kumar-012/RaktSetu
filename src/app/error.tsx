"use client";

import { useEffect } from "react";

import { Button, ButtonLink } from "@/components/ui/Button";

/**
 * Route-level error boundary.
 *
 * The app previously had NO error boundary, so any throw in a server component
 * fell through to Next's default error screen — which, in development, prints
 * the message and stack, and in production shows a bare unstyled page with no
 * way back into the product.
 *
 * Two rules govern this component:
 *
 *   1. NOTHING technical reaches the user. `error.message` and `error.digest`
 *      are deliberately NOT rendered. A database message can carry table and
 *      column names, a Supabase URL, or fragments of a query. The digest is a
 *      build-time hash, not a secret, but it is meaningless to a user, so it is
 *      logged for correlation instead of displayed.
 *   2. The page stays usable. Retry re-renders the segment; the links are real
 *      routes, so a user is never stranded.
 *
 * The same error is logged server-side by Next, so this console line is
 * supplementary rather than the only record.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Correlate the digest with the server log; never surface either to the user.
    console.error("Unhandled route error", {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center gap-4 text-center">
      <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
        Something went wrong
      </p>
      <h1 className="text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
        We couldn&apos;t load this page
      </h1>
      <p className="text-lg text-ink-600">
        This is on us, not on you. Nothing you submitted has been lost — try
        again, and if it keeps happening contact us and we&apos;ll look into it.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Button type="button" onClick={reset}>
          Try again
        </Button>
        <ButtonLink href="/" variant="secondary">
          Back to home
        </ButtonLink>
        <ButtonLink href="/contact" variant="secondary">
          Contact us
        </ButtonLink>
      </div>
    </div>
  );
}
