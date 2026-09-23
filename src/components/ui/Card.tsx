import { cn } from "@/lib/cn";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Slightly lifted style with a stronger shadow. Ignored when `glass`. */
  raised?: boolean;
  /**
   * Frosted-glass surface (see `.glass` in globals.css). Use selectively on
   * summaries and important request/alert surfaces — never behind dense
   * tables or long forms. The glass class owns background, border, and
   * shadow, so no other bg/border/shadow utilities are applied alongside it.
   */
  glass?: boolean;
}

export function Card({ raised, glass, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg",
        glass
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
