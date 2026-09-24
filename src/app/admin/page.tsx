import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/utils";
import type { AdminOverview } from "@/types";

export const metadata = { title: "Overview — admin" };

/**
 * Platform overview. All figures come from admin_platform_overview() —
 * a SECURITY DEFINER function that re-verifies the admin role on every
 * call. Non-admins calling the RPC get an empty result.
 */
export default async function AdminOverviewPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("admin_platform_overview");
  const overview = (data as AdminOverview[] | null)?.[0];

  if (!overview) {
    return (
      <Section className="max-w-2xl">
        <Alert variant="warning" title="Overview unavailable">
          The platform overview could not be read. Your account may not be an active
          administrator, or migration 0010 has not been applied yet.
        </Alert>
      </Section>
    );
  }

  const userStats: { label: string; value: number }[] = [
    { label: "Registered users", value: overview.total_users },
    { label: "Donors", value: overview.total_donors },
    { label: "Requesters", value: overview.total_requesters },
    { label: "Volunteers", value: overview.total_volunteers },
    { label: "Administrators", value: overview.total_admins },
    { label: "Suspended accounts", value: overview.suspended_users },
  ];

  const requestStats: { label: string; value: number }[] = [
    { label: "Active requests", value: overview.active_requests },
    { label: "Fulfilled", value: overview.fulfilled_requests },
    { label: "Expired", value: overview.expired_requests },
    { label: "Cancelled", value: overview.cancelled_requests },
    { label: "Completed donations", value: overview.completed_donations },
  ];

  // Moderation queue, straight from the database. These count REPORTS, not
  // requests: a reported request keeps its own lifecycle and is never hidden
  // or cancelled because someone reported it.
  const reportStats: { label: string; value: number }[] = [
    { label: "Open reports", value: overview.open_reports },
    { label: "Under review", value: overview.under_review_reports },
    { label: "Resolved", value: overview.resolved_reports },
    { label: "Filed in the last 24h", value: overview.reports_last_24h },
  ];

  const alertStats: { label: string; value: number }[] = [
    { label: "Alerts in rings (queued/sent/opened)", value: overview.active_alerts },
    { label: "Accepted donor relationships", value: overview.accepted_alerts },
    { label: "Available, eligible donors", value: overview.available_donors },
  ];

  const isPlatformEmpty = [
    ...userStats,
    ...requestStats,
    ...alertStats,
    ...reportStats,
  ].every((s) => s.value === 0);

  function StatList({
    title,
    stats,
  }: {
    title: string;
    stats: { label: string; value: number }[];
  }) {
    return (
      <div className="glass rounded-lg p-6">
        <h2 className="text-xl font-bold tracking-tight text-ink-900">{title}</h2>
        <dl className="mt-4 divide-y divide-ink-100">
          {stats.map((s) => (
            <div key={s.label} className="flex items-center justify-between py-3">
              <dt className="text-base text-ink-600">{s.label}</dt>
              <dd className="text-xl font-extrabold text-ink-900">{s.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Admin · Overview"
        title="Platform overview"
        description="Live figures from the database — no demo data."
      />
      <Section>
        <div className="grid gap-6 lg:grid-cols-2">
          <StatList title="Users" stats={userStats} />
          <div className="space-y-6">
            <StatList title="Requests & donations" stats={requestStats} />
            <StatList title="Alerts & donors" stats={alertStats} />
            <StatList title="Report moderation" stats={reportStats} />
          </div>
        </div>

        {overview.open_reports > 0 && (
          <Alert variant="warning" title={`${overview.open_reports} open report(s)`} className="mt-8">
            Review them in the Reports section. A reported request keeps its own
            lifecycle — reporting never cancels or hides it.
          </Alert>
        )}

        {/* A fresh deployment is genuinely all zeros. Showing an unexplained wall
            of 0s reads as a broken dashboard, so say so plainly — and say what
            will populate it. Nothing is seeded, estimated or fabricated. */}
        {isPlatformEmpty && (
          <div className="mt-8 rounded-lg border border-dashed border-ink-200 bg-ink-50 p-6">
            <h2 className="text-lg font-bold text-ink-900">No activity yet</h2>
            <p className="mt-2 text-base leading-relaxed text-ink-600">
              These figures come straight from the database and nothing has been
              recorded yet. They fill in as soon as the first account registers
              and the first blood request is created — no data is pre-populated
              or estimated to make the dashboard look busier.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <ButtonLink href="/admin/users" variant="secondary">
                Manage users
              </ButtonLink>
              <ButtonLink href="/admin/settings" variant="secondary">
                Platform settings
              </ButtonLink>
            </div>
          </div>
        )}

        <div className="mt-10 flex flex-wrap gap-4">
          <ButtonLink href="/admin/users" variant="secondary">Manage users</ButtonLink>
          <ButtonLink href="/admin/requests" variant="secondary">View requests</ButtonLink>
          <ButtonLink href="/admin/reports" variant="secondary">Review reports</ButtonLink>
          <ButtonLink href="/admin/alerts" variant="secondary">View alerts</ButtonLink>
          <ButtonLink href="/admin/settings" variant="secondary">Platform settings</ButtonLink>
        </div>

        <p className="mt-8 text-sm text-ink-600">
          Overview generated {formatDateTime(new Date().toISOString())}.
        </p>
      </Section>
    </>
  );
}

