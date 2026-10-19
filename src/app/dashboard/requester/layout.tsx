import type { Metadata } from "next";

import { SlotImage } from "@/components/ui/SlotImage";

// The dashboard page is a Client Component (it loads its data after mount),
// and a client module may not export `metadata`, so the title is declared here.
export const metadata: Metadata = { title: "Requester dashboard" };

export default function RequesterDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      {children}
      {/* The page is a client component, so the photo (which reads the disk via
          SlotImage) is rendered here and laid over the page header's right side. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 hidden lg:block">
        <div className="mx-auto flex max-w-6xl justify-end px-6 pt-8">
          <SlotImage
            slot="requesterDashboard"
            sizes="208px"
            className="h-56 w-52"
          />
        </div>
      </div>
    </div>
  );
}
