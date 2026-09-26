"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { addRoleToCurrentAccount, switchActiveRole } from "@/lib/actions/auth";
import { REGISTER_ROLES } from "@/lib/constants";
import type { AccountRole } from "@/types";

const LABELS: Record<AccountRole, string> = {
  donor: "Donor",
  requester: "Requester",
  volunteer: "Volunteer",
  admin: "Admin",
};

/** Where each profile's own dashboard lives, so switching lands somewhere valid. */
const HOME: Record<AccountRole, string> = {
  donor: "/dashboard/donor",
  requester: "/dashboard/requester",
  volunteer: "/dashboard/volunteer",
  admin: "/dashboard/admin",
};

/**
 * The profile switcher.
 *
 * One account, several roles, one session. Choosing a profile calls a server
 * action that re-checks the account's OWN memberships and rewrites the session
 * row; nothing about the choice is trusted from the browser, and nothing is
 * kept in browser storage. The page then re-renders from the server, so what the
 * navbar shows and what the guards enforce are the same answer.
 *
 * TWO PRESENTATIONS, one behaviour:
 *
 *  - `full` (the default) is the roomy form used on /profile. It shows the active
 *    profile, the switch buttons, and the "become a …" actions, and it wraps
 *    freely because a page has room to wrap.
 *  - `compact` is a SINGLE native control for the navbar. A row of buttons is
 *    the wrong shape for a 64px-tall bar: with three roles to offer it measured
 *    over a thousand pixels wide and pushed the whole page sideways. One
 *    <select> is one control at any width, and it brings native keyboard and
 *    touch behaviour for free.
 *
 * "Become a …" deliberately stays out of the compact form: adding a capability
 * is a deliberate act that belongs on the profile page, not in a bar.
 *
 * Rendered only when the account actually holds more than one role, and only
 * when it is missing one it is offered to add — a single-role account with
 * nothing to add sees no switcher at all.
 */
export function RoleSwitcher({
  activeRole,
  roles,
  variant = "full",
}: {
  activeRole: AccountRole;
  roles: AccountRole[];
  variant?: "full" | "compact";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Roles this account could add. REGISTER_ROLES excludes admin by construction,
  // so admin can never be offered here — let alone granted.
  const addable = REGISTER_ROLES.map((r) => r.value as AccountRole).filter(
    (r) => !roles.includes(r),
  );
  if (roles.length <= 1 && addable.length === 0) return null;

  function run(label: string, work: () => Promise<{ error: string | null }>) {
    setBusy(label);
    setError(null);
    startTransition(async () => {
      const result = await work();
      setBusy(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const switchTo = (role: AccountRole) =>
    run(`switch:${role}`, async () => {
      const result = await switchActiveRole({ role });
      if (result.error) return { error: result.error };
      // Land on the new profile's own dashboard, so the user is not left on a
      // page their active profile no longer permits.
      router.push(HOME[role]);
      return { error: null };
    });

  const add = (role: AccountRole) =>
    run(`add:${role}`, async () => {
      const result = await addRoleToCurrentAccount({ role });
      if (result.error) return { error: result.error };
      router.push(HOME[role]);
      return { error: null };
    });

  // The navbar form: one control, always fits, no extra affordances.
  if (variant === "compact") {
    if (roles.length < 2) return null;
    return (
      <div className="relative min-w-0">
        <label htmlFor="navbar-role-switcher" className="sr-only">
          Acting as — switch profile
        </label>
        <select
          id="navbar-role-switcher"
          value={activeRole}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.value as AccountRole;
            if (next !== activeRole) void switchTo(next);
          }}
          // The bar is 64px tall, so the control keeps a comfortable touch
          // target without growing the bar.
          className="max-w-[9.5rem] truncate rounded-md border border-ink-300 bg-white py-1.5 pl-2.5 pr-7 text-sm font-semibold text-ink-800 hover:bg-ink-50 disabled:opacity-60"
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {LABELS[r]}
            </option>
          ))}
        </select>
        {/* Announced to screen readers without taking visual space. */}
        <p role="status" aria-live="polite" className="sr-only">
          {busy ? `Switching to ${busy.split(":")[1] ?? ""}` : `Acting as ${LABELS[activeRole]}`}
        </p>
        {error && (
          <p
            role="alert"
            className="absolute left-0 top-full z-10 mt-1 w-56 rounded-md border border-red-200 bg-white p-2 text-xs font-medium text-red-700 shadow-md"
          >
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
        Current profile
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-blood-200 bg-blood-50 px-3 py-1.5 text-base font-bold text-blood-800">
          {LABELS[activeRole]}
        </span>
        {roles
          .filter((r) => r !== activeRole)
          .map((r) => (
            <button
              key={r}
              type="button"
              disabled={pending}
              onClick={() => switchTo(r)}
              className="rounded-md border border-ink-300 bg-white px-3 py-1.5 text-base font-semibold text-ink-800 hover:bg-ink-50 disabled:opacity-60"
            >
              {busy === `switch:${r}` ? "Switching…" : `Switch to ${LABELS[r]}`}
            </button>
          ))}
        {addable.map((r) => (
          <button
            key={`add-${r}`}
            type="button"
            disabled={pending}
            onClick={() => add(r)}
            className="rounded-md border border-dashed border-ink-300 px-3 py-1.5 text-base font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-60"
          >
            {busy === `add:${r}` ? "Adding…" : `Become a ${LABELS[r].toLowerCase()}`}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}