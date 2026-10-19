import { cn } from "@/lib/cn";

/**
 * Consistent page header for internal (non-home) pages.
 * `aside` is a plain slot (usually a server-rendered <SlotImage>): importing
 * SlotImage here would pull node:fs into the client pages that use this header.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  className,
  aside,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  className?: string;
  aside?: React.ReactNode;
}) {
  return (
    // `glass-band` rather than a flat `bg-white`: the band is translucent, so
    // the ambient background reads continuously from the page into the band
    // instead of being cut by an opaque strip.
    <div className={cn("glass-band overflow-hidden", className)}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-10 px-4 py-14 sm:px-6">
        <div>
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
        {aside}
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
