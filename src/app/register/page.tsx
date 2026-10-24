import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RegisterForm } from "@/components/auth/RegisterForm";
import { AuthShell } from "@/components/auth/AuthShell";
import { JoinAside } from "@/components/auth/JoinAside";
import { getSessionInfo } from "@/lib/profile";

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
  // Checked here, not in middleware: only the server can tell a valid session
  // from a stale cookie, and guessing from the cookie alone caused a redirect loop.
  if ((await getSessionInfo()).user) redirect("/dashboard");

  return (
    <AuthShell
      aside={<JoinAside />}
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
