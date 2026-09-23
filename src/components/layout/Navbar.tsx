"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { LogoutButton } from "@/components/auth/LogoutButton";
import { ButtonLink } from "@/components/ui/Button";
import { APP_NAME, MAIN_NAV_ITEMS } from "@/lib/constants";
import { cn } from "@/lib/cn";
import type { Profile } from "@/types";

/** RaktSetu wordmark: a simple blood-drop glyph plus bold text. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label={`${APP_NAME} home`}>
      <span
        aria-hidden
        className="flex h-9 w-9 items-center justify-center rounded-full bg-blood-700 text-white shadow-md"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
          <path d="M12 2.5C12 2.5 5.5 10 5.5 14.6a6.5 6.5 0 0 0 13 0C18.5 10 12 2.5 12 2.5Z" />
        </svg>
      </span>
      {!compact && (
        <span className="text-2xl font-extrabold tracking-tight text-ink-900">
          Rakt<span className="text-blood-700">Setu</span>
        </span>
      )}
    </Link>
  );
}

/** Unread pill for the notification link — always an exact database count. */
function UnreadBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "rounded-full bg-blood-700 px-2 py-0.5 text-xs font-bold text-white",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function Navbar({
  authed,
  profile,
  unreadNotifications = 0,
}: {
  authed: boolean;
  profile: Profile | null;
  /** Unread in-app notifications for the signed-in user (0 when signed out). */
  unreadNotifications?: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const firstName = profile?.full_name?.trim()?.split(" ")[0];
  // Role-aware dashboard target — /dashboard itself redirects by role too.
  const dashboardHref = profile?.role ? `/dashboard/${profile.role}` : "/dashboard";
  const notificationsLabel =
    unreadNotifications > 0
      ? `Notifications, ${unreadNotifications} unread`
      : "Notifications";

  const navLinkClass = (href: string) =>
    cn(
      "rounded-md px-3 py-2 text-base font-semibold transition-colors",
      pathname === href
        ? "text-blood-700 bg-blood-50"
        : "text-ink-800 hover:text-blood-700 hover:bg-ink-100"
    );

  return (
    <header className="sticky top-0 z-50 glass-bar border-b border-ink-200">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Brand />

        <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">
          {MAIN_NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className={navLinkClass(item.href)}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          {authed ? (
            <>
              {firstName && (
                <span className="text-base font-semibold text-ink-600">
                  Hi, {firstName}
                </span>
              )}
              <span className="relative inline-flex items-center">
                <ButtonLink
                  href="/notifications"
                  variant="ghost"
                  size="md"
                  aria-label={notificationsLabel}
                >
                  Notifications
                </ButtonLink>
                <UnreadBadge
                  count={unreadNotifications}
                  className="pointer-events-none absolute -right-1 -top-1"
                />
              </span>
              <ButtonLink href="/profile" variant="ghost" size="md">
                Profile
              </ButtonLink>
              <ButtonLink href={dashboardHref} size="md">
                Dashboard
              </ButtonLink>
              <LogoutButton />
            </>
          ) : (
            <>
              <ButtonLink href="/login" variant="ghost" size="md">
                Log in
              </ButtonLink>
              <ButtonLink href="/register" size="md">
                Join RaktSetu
              </ButtonLink>
            </>
          )}
        </div>

        <button
          type="button"
          aria-expanded={open}
          aria-label="Toggle navigation menu"
          onClick={() => setOpen((v) => !v)}
          className="flex h-11 w-11 items-center justify-center rounded-md text-ink-800 hover:bg-ink-100 md:hidden"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? (
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>

      {open && (
        <div className="border-t border-ink-200 px-4 pb-6 pt-2 md:hidden">
          <nav aria-label="Mobile navigation" className="flex flex-col gap-1">
            {MAIN_NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={navLinkClass(item.href)}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-4 flex flex-col gap-3">
            {authed ? (
              <>
                {firstName && (
                  <p className="px-3 text-base font-semibold text-ink-600">
                    Hi, {firstName}
                  </p>
                )}
                <ButtonLink href={dashboardHref} onClick={() => setOpen(false)}>
                  Dashboard
                </ButtonLink>
                <ButtonLink
                  href="/notifications"
                  variant="secondary"
                  aria-label={notificationsLabel}
                  onClick={() => setOpen(false)}
                >
                  Notifications
                  <UnreadBadge count={unreadNotifications} />
                </ButtonLink>
                <ButtonLink
                  href="/profile"
                  variant="secondary"
                  onClick={() => setOpen(false)}
                >
                  My profile
                </ButtonLink>
                <LogoutButton />
              </>
            ) : (
              <>
                <ButtonLink href="/login" variant="secondary" onClick={() => setOpen(false)}>
                  Log in
                </ButtonLink>
                <ButtonLink href="/register" onClick={() => setOpen(false)}>
                  Join RaktSetu
                </ButtonLink>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
