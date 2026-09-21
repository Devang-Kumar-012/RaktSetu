import { cn } from "@/lib/cn";

/** Consistent page header for internal (non-home) pages. */
export function PageHeader({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-ink-200 bg-white", className)}>
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        {eyebrow && (
          <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-2 max-w-3xl text-4xl font-extrabold tracking-tight text-ink-900 sm:text-5xl">
          {title}
        </h1>
        {description && (
          <p className="mt-4 max-w-2xl text-lg text-ink-600">{description}</p>
        )}
      </div>
    </div>
  );
}

/** Standard content container for page bodies. */
export function Section({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16", className)}>
      {children}
    </div>
  );
}
