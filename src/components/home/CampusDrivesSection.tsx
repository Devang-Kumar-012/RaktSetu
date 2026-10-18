import { Section } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";

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
      <div className="glass rounded-lg p-6 sm:p-10">
        <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
          Campus blood drives
        </p>
        <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
          Planned drives, organised with colleges
        </h2>
        <p className="mt-4 max-w-3xl text-lg leading-relaxed text-ink-700">
          Alongside emergency requests, RaktSetu runs organised blood donation
          drives. Browse what is coming up, see the venue and timings, and
          register your interest.
        </p>

        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
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

        <div className="mt-8 flex flex-wrap gap-4">
          <ButtonLink href="/drives" size="lg">
            Browse blood drives
          </ButtonLink>
          <ButtonLink href="/donor" variant="secondary" size="lg">
            Become a donor
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}
