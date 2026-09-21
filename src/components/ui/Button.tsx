import Link from "next/link";
import { forwardRef } from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-semibold transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-blood-700 text-white hover:bg-blood-800 focus-visible:outline-blood-700 " +
    "shadow-[0_1px_2px_rgba(0,0,0,0.2),0_4px_10px_rgba(170,31,31,0.25)]",
  secondary:
    "bg-white text-ink-900 border border-ink-200 hover:bg-ink-100 " +
    "focus-visible:outline-ink-400",
  ghost:
    "bg-transparent text-blood-700 hover:bg-blood-50 focus-visible:outline-blood-600",
  danger:
    "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600",
};

const sizes: Record<ButtonSize, string> = {
  md: "px-5 py-2.5 text-base rounded-md",
  lg: "px-7 py-3.5 text-lg rounded-md",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = "primary", size = "md", className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], sizes[size], className)}
        {...rest}
      />
    );
  }
);

export interface ButtonLinkProps extends React.ComponentPropsWithoutRef<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Same visual language as Button, rendered as a Next.js Link. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link
      className={cn(base, variants[variant], sizes[size], className)}
      {...rest}
    />
  );
}
