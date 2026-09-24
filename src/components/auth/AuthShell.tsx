import type { ReactNode } from "react";

/**
 * Shared shell for every authentication route (login, register, forgot
 * password, reset password).
 *
 * One component rather than four hand-rolled pages, because the prompt asks for
 * a single coherent identity across auth — if each route built its own panel
 * they would drift apart the moment one of them was edited.
 *
 * Structure is deliberately simple and in normal document flow: a soft wash on
 * the section, ONE frosted panel, then optional supporting content beneath it.
 * No nested cards, nothing floating over anything, and the panel is bounded so
 * the blur never covers a whole page.
 */
export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  description: string;
  /** The form or form-adjacent content, rendered inside the glass panel. */
  children: ReactNode;
  /** Optional quiet content rendered BELOW the panel, outside the glass. */
  footer?: ReactNode;
}) {
  return (
    <section className="auth-wash">
      <div className="mx-auto w-full max-w-xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="text-center">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-blood-700">
            {eyebrow}
          </p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
            {title}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-lg text-ink-600">{description}</p>
        </div>

        {/* The single glass surface on the route. */}
        <div className="glass-panel mt-8 rounded-2xl p-6 sm:p-8">{children}</div>

        {footer ? (
          <div className="mt-6 text-center text-base text-ink-600">{footer}</div>
        ) : null}
      </div>
    </section>
  );
}