"use client";

import { forwardRef, useState } from "react";

import { cn } from "@/lib/cn";
import { Input, type InputProps } from "./Input";

export interface PasswordInputProps extends Omit<InputProps, "type"> {
  /** Initial visibility. Defaults to hidden, which is the safe default. */
  defaultVisible?: boolean;
}

/**
 * Password field with a show/hide control.
 *
 * A separate Client Component (not a prop on Input) for two reasons:
 *
 *   1. It owns a piece of state (visibility), so it needs "use client". Keeping
 *      it here means Input/Select/Textarea stay server-renderable — marking
 *      Input.tsx as a client module would break every server component that
 *      renders a plain <Input>, such as the /contact page.
 *   2. Every password field in auth then gets the same accessible control
 *      instead of only some of them having one.
 *
 * Accessibility: a real <button type="button">, so it is keyboard reachable and
 * does NOT submit the form. `aria-pressed` plus the changing label announce the
 * current state, and the focus ring is kept so it is clearly keyboard-usable.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ defaultVisible = false, ...rest }, ref) {
    const [visible, setVisible] = useState(defaultVisible);
    return (
      <div className="relative">
        <Input
          {...rest}
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn("pr-20", rest.className)}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute right-2 top-[2.55rem] rounded-md px-2 py-1 text-sm font-semibold text-ink-600 hover:bg-ink-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blood-600"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    );
  }
);
