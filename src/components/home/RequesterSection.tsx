import { Section } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";

const steps = [
  {
    title: "Create the request",
    body: "Blood group, component, units, hospital, locality, urgency and the time it is needed by.",
  },
  {
    title: "Watch it move",
    body: "Follow which alert ring is running, how many compatible donors have been reached, and whether anyone has accepted.",
  },
  {
    title: "Contact the accepted donor",
    body: "Only after a valid acceptance do you see the donor's contact details, and only until the response window closes.",
  },
  {
    title: "Close the request",
    body: "Mark it fulfilled once the blood is arranged, or cancel it if the need has passed. Either way, alerting stops at once.",
  },
];

/**
 * Requester-facing section. Deliberately describes ONLY what the requester
 * journey really does — create, monitor, contact, close — and never implies the
 * platform sources or guarantees blood.
 */
export function RequesterSection() {
  return (
    <Section>
      <div className="max-w-3xl">
        <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
          For requesters
        </p>
        <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
          You don&apos;t have to be on your phone the whole time
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-ink-600">
          A relative or friend can raise the request on your behalf. RaktSetu
          coordinates who gets asked and when — arranging the actual transfusion
          stays with you and the hospital.
        </p>

        <ol className="mt-8 space-y-5">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blood-600 text-sm font-extrabold text-white"
              >
                {i + 1}
              </span>
              <div>
                <h3 className="text-lg font-bold text-ink-900">{step.title}</h3>
                <p className="mt-1 text-base leading-relaxed text-ink-600">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-8 flex flex-wrap gap-4">
          <ButtonLink href="/request-blood" size="lg">
            Request blood
          </ButtonLink>
          <ButtonLink href="/register?role=requester" variant="secondary" size="lg">
            Create a requester account
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}
