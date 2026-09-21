import { cn } from "@/lib/cn";

export type AlertVariant = "info" | "success" | "warning" | "error";

const variants: Record<AlertVariant, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-900",
  success: "border-green-200 bg-green-50 text-green-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-900",
};

export function Alert({
  variant = "info",
  title,
  className,
  children,
}: {
  variant?: AlertVariant;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="alert" className={cn("rounded-md border px-5 py-4", variants[variant], className)}>
      {title && <p className="font-bold">{title}</p>}
      <div className={cn("text-base", title && "mt-1")}>{children}</div>
    </div>
  );
}
