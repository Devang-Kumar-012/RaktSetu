import { cn } from "@/lib/cn";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Slightly lifted style with a stronger shadow. Ignored when glass. */
  raised?: boolean;
  /**
   * Frosted-glass surface (see `.glass` in globals.css).
   *
   * This is the DEFAULT for every Card, which is what makes the glassmorphism a
   * site-wide design language rather than a decoration on a handful of pages.
   * `Card` is the one shared container the dashboards, profile, request cards,
   * alert cards and admin panels are all built from, so styling it once applies
   * the treatment everywhere without duplicating class strings.
   *
   * Pass `solid` to opt OUT. That is for the two places readability wins over
   * effect — dense data tables and long filter forms, where a translucent
   * background behind many rows of text is genuinely harder to read. Those
   * surfaces are deliberately NOT glass (see invariant 19 in check-rings).
   */
  glass?: boolean;
  /**
   * Opt out of the default frosted treatment and use an opaque surface. Use only
   * where translucency would hurt legibility (dense tables, long forms).
   */
  solid?: boolean;
}

export function Card({
  raised,
  glass,
  solid,
  className,
  children,
  ...rest
}: CardProps) {
  // Glass unless explicitly opted out; `glass` stays supported (and is still
  // used explicitly in several places) so no call site had to change.
  const frosted = solid ? false : glass !== false;
  return (
    <div
      className={cn(
        "rounded-lg",
        frosted
          ? "glass"
          : cn("border border-ink-200 bg-white", raised ? "shadow-lg" : "shadow-sm"),
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 pt-6 pb-2", className)} {...rest} />;
}

export function CardTitle({ className, ...rest }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-xl font-bold tracking-tight text-ink-900", className)}
      {...rest}
    />
  );
}

export function CardBody({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 pb-6", className)} {...rest} />;
}
