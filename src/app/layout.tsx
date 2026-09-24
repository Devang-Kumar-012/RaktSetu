import type { Metadata } from "next";

import { Footer } from "@/components/layout/Footer";
import { Navbar } from "@/components/layout/Navbar";
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from "@/lib/constants";
import { getUnreadNotificationCount } from "@/lib/notifications-server";
import { getSessionInfo } from "@/lib/profile";
import { tickAlertRings } from "@/lib/ring-engine";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — ${APP_TAGLINE}`,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Read once per request; Navbar reflects the real auth state on every page.
  const { user, profile } = await getSessionInfo();
  // Unread notification badge for the authenticated shell — an exact count
  // from the database (own rows only), never inferred from a page's list.
  const unreadNotifications = user ? await getUnreadNotificationCount(user.id) : 0;

  // Opportunistic ring-engine tick, ONLY for signed-in traffic.
  //
  // pg_cron (migration 0011) remains the real scheduler and runs every minute
  // inside the database, with no browser and no application server involved.
  // This is a genuine safety net for when pg_cron is not executing — most
  // importantly while a paused Supabase project runs no database cron at all,
  // where rings and expiry would otherwise stall. Restricted to authenticated
  // requests so public page views never drive database sweeps, and it is a
  // no-op whenever there is no work to do.
  if (user) {
    await tickAlertRings();
  }

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col antialiased">
        <Navbar
          authed={Boolean(user)}
          profile={profile}
          unreadNotifications={unreadNotifications}
        />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
