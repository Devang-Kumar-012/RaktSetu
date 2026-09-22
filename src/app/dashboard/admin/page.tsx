import { requireRolePage } from "@/lib/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Card, CardBody } from "@/components/ui/Card";
import { ComingSoon } from "@/components/ui/States";
import type { AccountRole } from "@/types";

export const metadata = { title: "Admin dashboard" };

interface AdminProfileRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
}

/**
 * Admin list read directly through the admin RLS policy created in
 * migration 0001 — the database itself decides what is visible here.
 * Non-admins can never reach this page (requireRolePage redirects), and
 * even a crafted query would return only their own row.
 */
export default async function AdminDashboardPage() {
  const { profile } = await requireRolePage("admin");

  const supabase = await createSupabaseServerClient();
  const { data: accounts } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, status, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = (accounts ?? []) as AdminProfileRow[];
  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.role] = (acc[row.role] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        eyebrow="Admin dashboard"
        title={`Platform overview`}
        description={`Signed in as ${profile.full_name} — you see every account through database-enforced admin policies.`}
      />

      <Section>
        <Card>
          <CardBody className="flex flex-wrap items-center gap-x-10 gap-y-4 pt-2">
            {(["donor", "requester", "volunteer", "admin"] as AccountRole[]).map((role) => (
              <div key={role}>
                <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
                  {ROLE_LABELS[role]}s
                </p>
                <p className="text-2xl font-extrabold text-ink-900">
                  {counts[role] ?? 0}
                  {role === "admin" ? " (incl. you)" : ""}
                </p>
              </div>
            ))}
          </CardBody>
        </Card>

        <Alert variant="info" title="Provisioning admins" className="mt-6">
          Admin accounts are never created through public registration. Promote a
          trusted account with the service role or SQL editor:
          <code className="mt-2 block overflow-x-auto rounded-md bg-ink-50 px-4 py-3 text-sm">
            update public.profiles set role = &apos;admin&apos; where email = &apos;…&apos;;
          </code>
        </Alert>

        <h2 className="mt-12 text-2xl font-extrabold tracking-tight text-ink-900">
          Latest accounts
        </h2>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-200">
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">
                  Name
                </th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">
                  Email
                </th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">
                  Role
                </th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">
                  Status
                </th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">
                  Joined
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100">
                  <td className="px-4 py-3 font-semibold text-ink-900">{row.full_name}</td>
                  <td className="px-4 py-3 text-ink-600">{row.email}</td>
                  <td className="px-4 py-3 text-ink-600">{ROLE_LABELS[row.role] ?? row.role}</td>
                  <td className="px-4 py-3 text-ink-600">
                    {row.status === "suspended" ? "Suspended" : "Active"}
                  </td>
                  <td className="px-4 py-3 text-ink-600">{formatDate(row.created_at)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-ink-600">
                    No accounts visible yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-12">
          <ComingSoon
            title="Moderation & request oversight"
            description="Verification of hospitals, request queue management, and account actions are being built right now. Every future admin change will be written to an audit log."
          />
        </div>
      </Section>
    </>
  );
}
