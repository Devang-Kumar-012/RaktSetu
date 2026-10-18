import { Section } from "@/components/layout/PageHeader";
import { ALERT_RING_LABELS, ALERT_RINGS_KM, ALERT_WINDOW_MINUTES } from "@/lib/constants";

const phases = [
  {
    title: "Closest first",
    body: "Alerts go to compatible, available donors near the hospital first.",
  },
  {
    title: "Wider only if needed",
    body: "No response in time? The alert widens to the next ring automatically.",
  },
  {
    title: "One last ring",
    body: "If help is still needed, the final ring covers the widest area — after that, the request stays open until its deadline.",
  },
];

/**
 * Emergency alert explainer — human-readable widening search in one bounded
 * glass-blood panel: starts nearby, expands when necessary, stops when help
 * is secured. No internal implementation details.
 */
export function EmergencyAlertSection() {
  return (
    <Section>
      <div className="glass-blood rounded-xl px-6 py-10 sm:px-10 sm:py-12">
        <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
          Emergency alerts
        </p>
        <h2 className="mt-2 max-w-2xl text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
          When the need is urgent, the search widens
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-700">
          Every request starts with donors closest to the hospital. If nobody
          responds in time, the alert reaches further out — and stops as soon
          as help is secured.
        </p>

        <ol className="mt-8 grid gap-4 sm:grid-cols-3">
          {phases.map((phase, i) => (
            <li
              key={phase.title}
              className="glass-blood rounded-lg px-5 py-4"
            >
              <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
                {ALERT_RING_LABELS[ALERT_RINGS_KM[i]] ?? `${ALERT_RINGS_KM[i]} km`}
              </p>
              <p className="mt-1 text-lg font-bold text-ink-900">{phase.title}</p>
              <p className="mt-1 text-base leading-relaxed text-ink-600">{phase.body}</p>
            </li>
          ))}
        </ol>

      </div>
    </Section>
  );
}
