import { Section } from "@/components/layout/PageHeader";

const steps = [
  {
    title: "Create the request",
    body: "Blood group, component, units, hospital, locality, urgency, and time needed."
  },
  {
    title: "Watch it move",
    body: "Follow the alert ring, compatible donors reached, and acceptances."
  },
  {
    title: "Contact the accepted donor",
    body: "Only after acceptance do you see the donor's contact details, until the window closes."
  },
  {
    title: "Close the request",
    body: "Mark it fulfilled once blood is arranged, or cancel if the need passed. Alerting stops at once."
  },
];

// What the hospital's blood bank will ask for; having it ready makes the request accurate and the donation fast.
const keepReady = [
  "Patient's blood group, from the hospital report",
  "Component and units the doctor has prescribed",
  "Hospital name, ward and the blood bank's location",
  "The blood bank's requisition form, if they gave one",
];

/**
 * Requester-facing section. Deliberately describes ONLY what the requester
 * journey really does — create, monitor, contact, close — and never implies the
 * platform sources or guarantees blood. No buttons: the hero and the final
 * call-to-action already carry "Request blood".
 */
export function RequesterSection() {
  return (
    <Section>
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
            For requesters
          </p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
            You don&apos;t have to be on your phone the whole time
          </h2>
          <p className="mt-4 text-base leading-relaxed text-ink-600">
            A relative or friend can raise the request on your behalf. RaktSetu
            coordinates who gets asked and when — arranging the transfusion stays
            with you and the hospital.
          </p>
          <div className="mt-6 rounded-lg border border-blood-200 bg-blood-50/70 p-5">
            <h3 className="text-base font-bold text-ink-900">Keep these ready before you post</h3>
            <ul className="mt-3 space-y-2">
              {keepReady.map((item) => (
                <li key={item} className="text-sm leading-relaxed text-ink-800">
                  <span aria-hidden="true" className="font-bold text-blood-700">•</span> {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <ol className="space-y-5 lg:pt-8">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blood-600 text-sm font-extrabold text-white"
              >
                {i + 1}
              </span>
              <div>
                <h3 className="text-base font-bold text-ink-900">{step.title}</h3>
                <p className="mt-1 text-base leading-relaxed text-ink-600">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
