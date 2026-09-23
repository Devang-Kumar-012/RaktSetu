import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRolePage } from "@/lib/profile";
import { PageHeader, Section } from "@/components/layout/PageHeader";
import { formatDate } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/constants";
import { AdminUserStatusControls } from "@/components/admin/AdminUserStatusControls";

export const metadata = { title: "Users — admin" };

// Session-gated: render per request so the admin role check is never baked
// into a static prerender (which would redirect forever in production).
export const dynamic = "force-dynamic";

interface AdminProfileRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
}

/**
 * Account management. Rows come straight from profiles through the admin
 * RLS policy (0001) — non-admins can only ever see their own row, so even a
 * crafted query here cannot leak other users.
 */
export default async function AdminUsersPage() {
  const { user } = await requireRolePage("admin");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data as AdminProfileRow[] | null) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Admin · Users"
        title="Account management"
        description={`${rows.length} most recent accounts. Emails are shown here only because this console is restricted to active administrators.`}
      />
      <Section>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-200">
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Name</th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Email</th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Role</th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Status</th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Joined</th>
                <th className="px-4 py-3 text-sm font-bold uppercase tracking-widest text-ink-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100 align-top">
                  <td className="px-4 py-4 font-semibold text-ink-900">{row.full_name}</td>
                  <td className="px-4 py-4 text-ink-600">{row.email}</td>
                  <td className="px-4 py-4 text-ink-600">{ROLE_LABELS[row.role] ?? row.role}</td>
                  <td className="px-4 py-4 text-ink-600">
                    {row.status === "suspended" ? "Suspended" : "Active"}
                  </td>
                  <td className="px-4 py-4 text-ink-600">{formatDate(row.created_at)}</td>
                  <td className="px-4 py-4">
                    <AdminUserStatusControls
                      userId={row.id}
                      status={row.status}
                      isSelf={row.id === user.id}
                    />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-ink-600">
                    No accounts visible.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
