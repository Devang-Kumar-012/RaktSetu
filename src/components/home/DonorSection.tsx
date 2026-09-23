import { Section } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";

const points = [
  "You stay in control — pause availability whenever you need to.",
  "Your phone number stays private and is never listed anywhere.",
  "Screening doesn't change — the blood bank decides, as it always has.",
];

/** Donor invitation — honest reasons to join, one prominent action. */
export function DonorSection() {
  return (
    <Section>
      <div className="max-w-3xl">
        <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
          For donors
        </p>
        <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
          Be the person nearby who can help
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-ink-600">
          Register once with your blood group and area. When a request near you
          needs your blood type, the alert reaches you — and every time, the
          choice to help is yours.
        </p>

        <ul className="mt-6 space-y-3">
          {points.map((point) => (
            <li key={point} className="text-base text-ink-800">
              <span aria-hidden="true" className="font-bold text-blood-700">
                ✓
              </span>{" "}
              {point}
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-wrap gap-4">
          <ButtonLink href="/donor" size="lg">
            Become a donor
          </ButtonLink>
          <ButtonLink href="/register" variant="secondary" size="lg">
            Create a free account
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}
