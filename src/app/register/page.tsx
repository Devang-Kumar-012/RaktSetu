import type { Metadata } from "next";

import { RegisterForm } from "@/components/auth/RegisterForm";
import { AuthShell } from "@/components/auth/AuthShell";

export const metadata: Metadata = { title: "Create account" };

// A role-specific CTA (e.g. /register?role=requester) preselects the role the
// person already chose, rather than being a link that implies a selection the
// page then ignores.
//
// One component, not a wrapper around an async inner helper: the nested helper
// left a second, unreachable <RegisterForm initialRole=...> in the file, so it
// was impossible to tell from the source which render was actually live.
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { role } = await searchParams;

  return (
    <AuthShell
      eyebrow="Join the network"
      title="Create your RaktSetu account"
      description="We collect the minimum: your name, email, and the role you play. No Aadhaar, no addresses, no health records at signup."
    >
      {/* initialRole is a convenience only. The form filters it against
          REGISTER_ROLES, so ?role=admin cannot preselect admin, and the
          database signup trigger rejects it regardless. */}
      <RegisterForm initialRole={role} />
    </AuthShell>
  );
}
