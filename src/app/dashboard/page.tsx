import { redirect } from "next/navigation";

import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { getSessionInfo } from "@/lib/profile";

// Session-gated: render per request so the auth/role check is never baked
// into a static prerender (which would redirect forever in production).
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { user, profile } = await getSessionInfo();

  if (!user) {
    // Middleware normally catches this; second line of defence.
    redirect("/login?next=%2Fdashboard");
  }

  // A suspended account is not sent to its role dashboard. The role guard on
  // that page would catch it, but redirecting here gives one clear message
  // instead of a redirect chain, and matches the rule in requireRolePage.
  if (profile) {
    if (profile.status !== "active") {
      redirect("/account-suspended");
    }
    // Send every user straight to the dashboard for their role.
    redirect(`/dashboard/${profile.role}`);
  }

  // Signed in, but the profile row is missing. With the local store a profile
  // is created at signup, so this is only reachable if local data was edited by
  // hand — say so plainly instead of blaming a database migration.
  return (
    <>
      <PageHeader
        eyebrow="Your account"
        title="Dashboard"
        description="One place for your requests, donor alerts, and activity."
      />
      <Section className="max-w-xl">
        <Alert variant="warning" title="Your profile could not be loaded">
          Your account is signed in, but its profile could not be read. Signing out
          and back in usually fixes this.
        </Alert>
      </Section>
    </>
  );
}
