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

  // Every navbar item shares one base, so the main nav, the account cluster and
  // the highlighted Dashboard all have identical typography, padding and
  // focus treatment. This is what previously made the bar look assembled from
  // unrelated parts (ButtonLink renders px-5 py-2.5; these were px-3 py-2).
  const navLinkBase =
    "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-700";

  const navLinkClass = (href: string) =>
    cn(
      navLinkBase,
      pathname === href
        ? "text-blood-700 bg-blood-50"
        : "text-ink-800 hover:text-blood-700 hover:bg-ink-100"
    );

  return (
    <header className="sticky top-0 z-50 glass-bar">
      {/*
        ONE horizontal bar, three vertically-centred zones:
          [brand] [main nav] .......... [account cluster]

        `xl` is deliberate. The account cluster carries five controls plus a
        greeting, so a single row overflows at tablet widths; below `xl` it
        collapses to the existing hamburger panel instead of squashing.
      */}
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <div className="shrink-0">
          <Brand />
        </div>

        {/* Main navigation, grouped. */}
        <nav
          aria-label="Main navigation"
          className="hidden shrink-0 items-center gap-0.5 xl:flex"
        >
          {MAIN_NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className={navLinkClass(item.href)}>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Account cluster, grouped and pushed right. */}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {authed ? (
            <>
              {/* Identity, not a link: an initial chip plus the name. */}
              {firstName && (
                <span className="mr-1 hidden items-center gap-2 pr-2 lg:flex">
                  <span
                    aria-hidden
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blood-700 text-xs font-bold text-white"
                  >
                    {firstName.charAt(0).toUpperCase()}
                  </span>
                  <span className="whitespace-nowrap text-sm font-semibold text-ink-700">
                    Hi, {firstName}
                  </span>
                </span>
              )}

              <Link
                href="/notifications"
                aria-label={notificationsLabel}
                className={navLinkClass("/notifications")}
              >
                Notifications
                <UnreadBadge count={unreadNotifications} />
              </Link>

              <Link href="/profile" className={navLinkClass("/profile")}>
                Profile
              </Link>
              <Link href="/drives" className={navLinkClass("/drives")}>
                Drives
              </Link>

              {/* Dashboard may stand out, but as a nav link — not a full
                  primary button, which is what unbalances the bar. */}
              <Link
                href={dashboardHref}
                className={cn(
                  navLinkBase,
                  "ml-1 border-l border-ink-200 pl-3",
                  pathname.startsWith("/dashboard")
                    ? "bg-blood-700 text-white hover:bg-blood-800"
                    : "text-blood-700 hover:bg-blood-50"
                )}
              >
                Dashboard
              </Link>

              <LogoutButton
                variant="ghost"
                className="ml-1 whitespace-nowrap px-3 text-base text-ink-700 hover:bg-ink-100 hover:text-ink-900"
              />
            </>
          ) : (
            <>
              <Link href="/login" className={navLinkClass("/login")}>
                Log in
              </Link>
              <Link
                href="/register"
                className="ml-1 inline-flex items-center rounded-md bg-blood-700 px-4 py-2 text-base font-semibold text-white transition-colors hover:bg-blood-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blood-700"
              >
                Create account
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          aria-expanded={open}
          aria-label="Toggle navigation menu"
          onClick={() => setOpen((v) => !v)}
          className="ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-800 hover:bg-ink-100 xl:hidden"
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
        <div className="border-t border-ink-200 px-4 pb-6 pt-2 xl:hidden">
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
                  Create account
                </ButtonLink>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
