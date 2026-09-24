import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, Section } from "@/components/layout/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Account suspended" };

/**
 * Shown after a suspended account is signed out (see
 * endSessionAndReportSuspension in src/lib/profile.ts).
 *
 * It states plainly that nothing was deleted — suspension blocks access, it does
 * not remove history — and gives one real next step. The session was already
 * ended server-side, so this page needs no session of its own and stays
 * reachable after sign-out.
 */
export default function AccountSuspendedPage() {
  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="This account is suspended"
        description="An administrator has paused access to RaktSetu for this account."
      />
      <Section className="max-w-2xl">
        <Card glass>
          <CardHeader>
            <CardTitle>What happened, and what is not lost</CardTitle>
          </CardHeader>
          <CardBody className="space-y-5">
            <p className="text-base text-ink-700">
              Your session has been signed out. Requests, donations, alerts and
              notifications you created are untouched — suspension only blocks
              access. Nothing has been deleted.
            </p>
            <Alert variant="warning" title="Why you may have been suspended">
              Accounts are paused for reports of misuse, duplicate or misleading
              requests, or another breach of the platform rules. If you believe
              this is a mistake, contact the RaktSetu team and an administrator
              can restore the account.
            </Alert>
            <p className="text-base text-ink-700">
              If you are in immediate need of blood, please do not wait — contact
              a blood bank or hospital directly. RaktSetu is a coordination aid,
              not a substitute for professional care.
            </p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/contact">Contact the team</ButtonLink>
              <Link
                href="/login"
                className="inline-flex items-center rounded-md border border-ink-200 px-4 py-2 text-base font-semibold text-ink-900 hover:bg-ink-50"
              >
                Back to log in
              </Link>
            </div>
          </CardBody>
        </Card>
      </Section>
    </>
  );
}