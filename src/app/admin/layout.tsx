import Link from "next/link";
import type { Metadata } from "next";

import { requireRolePage } from "@/lib/profile";
import { PageHeader, Section } from "@/components/layout/PageHeader";

export const metadata: Metadata = { title: "Administration" };

// The whole admin subtree is session-gated: force per-request rendering so
// the admin role check in this layout runs on every request, never at build time.
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/requests", label: "Requests" },
  { href: "/admin/alerts", label: "Alerts" },
  { href: "/admin/donations", label: "Donations" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/settings", label: "Settings" },
];

/**
 * Admin console layout. Authorization happens here, once, on the server:
 * only an ACTIVE admin account renders any admin page. Every data query is
 * additionally protected by RLS policies, and every admin server action
 * re-checks the role server-side.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireRolePage("admin");

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Admin console"
        description={`Signed in as ${profile.full_name}. All data here is database-enforced — admin RLS policies and role-checked server actions.`}
      />
      <Section>
        <nav className="flex flex-wrap gap-2" aria-label="Admin sections">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md border border-ink-200 bg-white px-4 py-2 text-base font-semibold text-ink-900 hover:bg-ink-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-10">{children}</div>
      </Section>
    </>
  );
}
