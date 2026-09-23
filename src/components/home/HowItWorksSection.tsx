import { Section } from "@/components/layout/PageHeader";

const steps = [
  {
    title: "Someone posts the request",
    body: "A friend, relative, or volunteer enters the blood group, hospital, and how soon it's needed. It takes a couple of minutes — the patient never opens the app.",
  },
  {
    title: "Nearby compatible donors are alerted",
    body: "RaktSetu looks for available donors with the right blood group near that hospital and reaches out to the closest ones first.",
  },
  {
    title: "A donor responds",
    body: "An alerted donor taps “I can help” or “I can't help”. The first donor to accept is connected to the requester.",
  },
  {
    title: "Coordination happens securely",
    body: "Contact details are shared only between the accepted donor and the requester, and only for a limited time. Screening at the blood bank remains the final step.",
  },
];

/** Four-step workflow — request → alerts → response → secure coordination. */
export function HowItWorksSection() {
  return (
    <Section>
      <h2 className="text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
        How RaktSetu works
      </h2>
      <p className="mt-4 max-w-2xl text-lg text-ink-600">
        Four steps between “someone needs blood” and a donor on their way to the
        blood bank.
      </p>

      <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => (
          <li key={step.title} className="border-t-2 border-blood-300 pt-5">
            <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
              Step {i + 1}
            </p>
            <h3 className="mt-2 text-lg font-bold text-ink-900">{step.title}</h3>
            <p className="mt-2 text-base leading-relaxed text-ink-600">{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
