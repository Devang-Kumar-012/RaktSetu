import { cn } from "@/lib/cn";

/** Spinner used for inline loading states and full-page fallbacks. */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label ?? "Loading"}
      className={cn(
        "inline-block h-6 w-6 animate-spin rounded-full border-[3px] border-blood-200 border-t-blood-700",
        className
      )}
    />
  );
}

export function PageLoader({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
      <Spinner className="h-10 w-10" />
      <p className="text-lg text-ink-600">{message}</p>
    </div>
  );
}

/** Skeleton block for list/table placeholders. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-ink-100", className)} />;
}
