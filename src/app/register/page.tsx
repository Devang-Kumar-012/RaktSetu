import type { Metadata } from "next";

import { PageHeader, Section } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ComingSoon } from "@/components/ui/States";

export const metadata: Metadata = { title: "Register" };

const roles = [
  "Requester — creating requests for someone who needs blood",
  "Donor — willing to be contacted when nearby blood is needed",
  "Volunteer — helping run and verify requests",
  "Hospital / blood bank staff — verifying requests and recording screening",
];

export default function RegisterPage() {
  return (
    <>
      <PageHeader
        eyebrow="Join the network"
        title="Create your RaktSetu account"
        description="We collect the minimum: your name, email, and the role you play. No Aadhaar, no addresses, no health records at signup."
      />
      <Section className="max-w-xl">
        <ComingSoon
          title="Registration is being wired up"
          description="Account creation will run entirely through Supabase Auth with email verification. Until it is live, this page only describes what signing up will involve — there is no fake form collecting data it cannot store."
        />
        <Card className="mt-8">
          <div className="p-6">
            <p className="font-semibold text-ink-900">What you will choose at signup</p>
            <ul className="mt-3 space-y-2 text-ink-600">
              {roles.map((r) => (
                <li key={r} className="flex gap-2">
                  <span aria-hidden className="text-blood-700">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-ink-400">
              Administrator accounts are provisioned internally — they cannot be created
              through public registration.
            </p>
          </div>
        </Card>
      </Section>
    </>
  );
}
