import { redirect } from "next/navigation";

import { getSessionInfo } from "@/lib/profile";

export const metadata = { title: "Admin dashboard" };

// Session-gated redirect: must evaluate the caller's role per request.
export const dynamic = "force-dynamic";

/**
 * The admin console lives at /admin. Send admins there; everyone else goes
 * to their own role dashboard (or /dashboard if logged out).
 */
export default async function AdminDashboardPage() {
  const { user, profile } = await getSessionInfo();
  if (user && profile?.role === "admin" && profile.status === "active") {
    redirect("/admin");
  }
  redirect(profile ? `/dashboard/${profile.role}` : "/dashboard");
}

