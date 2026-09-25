import type { Metadata } from "next";

// The dashboard page is a Client Component — the data lives in this visitor's
// localStorage, which a Server Component cannot read. A client module may not
// export `metadata`, so the route title is declared here.
export const metadata: Metadata = { title: "Requester dashboard" };

export default function RequesterDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
