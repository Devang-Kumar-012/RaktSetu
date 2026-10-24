import Link from "next/link";

import { Section } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";

// What a host college needs to line up; RaktSetu handles interest sign-ups and reminders.
const hostChecklist = [
  "A licensed blood bank to run the collection",
  "A hall with space for beds and a rest area",
  "A date at least two weeks ahead",
  "A student or staff coordinator",
];

/**
 * Campus Blood Drive showcase.
 *
 * Deliberately says these are PLANNED drives with a registration interest, not
 * a guarantee of a donation slot: the platform records interest, and the drive
 * organisers and blood bank do the rest. Public pages show no donor identities,
 * no contact details and no individual attendance — only drive logistics.
 */
export function CampusDrivesSection() {
  return (
    <Section>
      <div className="glass grid gap-8 rounded-lg p-6 sm:p-10 lg:grid-cols-[3fr_2fr]">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
            Campus blood drives
          </p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
            Planned drives, organised with colleges
          </h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-ink-700">
            Alongside emergency requests, RaktSetu runs organised blood donation
            drives. Browse what is coming up, see the venue and timings, and
            register your interest.
          </p>

          <ul className="mt-6 space-y-2">
            {[
              "See drive title, host organisation, date, venue and locality.",
              "Register or withdraw your interest in a few taps.",
              "Get notified when the schedule changes or a drive is called off.",
            ].map((item) => (
              <li key={item} className="text-base leading-relaxed text-ink-800">
                <span aria-hidden="true" className="font-bold text-blood-700">
                  ✓
                </span>{" "}
                {item}
              </li>
            ))}
          </ul>

          <div className="mt-8">
            <ButtonLink href="/drives" size="lg">
              Browse blood drives
            </ButtonLink>
          </div>
        </div>

        <div className="rounded-lg border border-ink-200 bg-white/70 p-5 sm:p-6">
          <h3 className="text-base font-bold text-ink-900">Want to host one at your college?</h3>
          <p className="mt-1 text-sm text-ink-600">You&apos;ll need:</p>
          <ul className="mt-3 space-y-2">
            {hostChecklist.map((item) => (
              <li key={item} className="text-sm leading-relaxed text-ink-800">
                <span aria-hidden="true" className="font-bold text-blood-700">•</span> {item}
              </li>
            ))}
          </ul>
          <Link href="/contact" className="mt-4 inline-block text-sm font-semibold text-blood-700 underline underline-offset-4">
            Talk to us about hosting a drive
          </Link>
        </div>
      </div>
    </Section>
  );
}
