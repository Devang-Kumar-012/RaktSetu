import { redirect } from "next/navigation";

import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { getSessionInfo } from "@/lib/profile";

// Session-gated: render per request so the auth/role check is never baked
// into a static prerender (which would redirect forever in production).
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { configured, user, profile } = await getSessionInfo();

  if (!configured) {
    return (
      <>
        <PageHeader
          eyebrow="Your account"
          title="Dashboard"
          description="One place for your requests, donor alerts, and activity."
        />
        <Section className="max-w-xl">
          <Alert variant="warning" title="Authentication is not configured yet">
            The Supabase project URL and anon key are missing from this deployment.
            Add them to <code>.env.local</code> and restart the app — then log in to see
            your dashboard here.
          </Alert>
        </Section>
      </>
    );
  }

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

  // Authenticated but no profile row yet (migration not applied, or brand-new account).
  return (
    <>
      <PageHeader
        eyebrow="Your account"
        title="Dashboard"
        description="One place for your requests, donor alerts, and activity."
      />
      <Section className="max-w-xl">
        <Alert variant="warning" title="Profile is still being set up">
          Your account exists, but its profile row has not been created yet. If this
          message stays, the database migrations (0001_profiles.sql and
          0002_role_profiles.sql) may not have been applied to the Supabase project yet.
        </Alert>
      </Section>
    </>
  );
}
