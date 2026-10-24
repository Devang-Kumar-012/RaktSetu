import { Section } from "@/components/layout/PageHeader";
import { ALERT_RING_LABELS, ALERT_RINGS_KM, ALERT_WINDOW_MINUTES } from "@/lib/constants";

const phases = [
  {
    title: "Closest first",
    body: "Alerts go to compatible, available donors near the hospital first.",
  },
  {
    title: "Wider only if needed",
    body: `No response within ${ALERT_WINDOW_MINUTES} minutes? The alert widens to the next ring automatically.`,
  },
  {
    title: "One last ring",
    body: "If help is still needed, the final ring covers the widest area — after that, the request stays open until its deadline.",
  },
];

/** Concentric rings for ALERT_RINGS_KM, hospital at the centre (evenly spaced, not to scale, so every label stays readable). */
function RingDiagram() {
  const n = ALERT_RINGS_KM.length;
  return (
    <svg viewBox="0 0 240 240" className="h-56 w-56 shrink-0 sm:h-64 sm:w-64" role="img"
      aria-label={`Alert rings at ${ALERT_RINGS_KM.join(", ")} km around the hospital`}>
      {[...ALERT_RINGS_KM].reverse().map((km, i) => {
        const r = 40 + ((n - 1 - i) * 70) / Math.max(n - 1, 1);
        return (
          <g key={km}>
            <circle cx="120" cy="120" r={r} fill={`rgba(170,31,31,${0.06 + i * 0.05})`} stroke="#aa1f1f" strokeOpacity="0.45" strokeDasharray={i === 0 ? "4 4" : undefined} />
            <text x="120" y={120 - r + 14} textAnchor="middle" fontSize="11" fontWeight="700" fill="#8b1d1d">{km} km</text>
          </g>
        );
      })}
      <circle cx="120" cy="120" r="9" fill="#aa1f1f" />
      <text x="120" y="142" textAnchor="middle" fontSize="10" fontWeight="700" fill="#3d0a0a">Hospital</text>
    </svg>
  );
}

/**
 * Emergency alert explainer — human-readable widening search in one bounded
 * glass-blood panel: starts nearby, expands when necessary, stops when help
 * is secured. No internal implementation details.
 */
export function EmergencyAlertSection() {
  return (
    <Section>
      <div className="glass-blood rounded-xl px-6 py-10 sm:px-10 sm:py-12">
        <div className="flex flex-col items-center gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
              Emergency alerts
            </p>
            <h2 className="mt-2 max-w-2xl text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
              When the need is urgent, the search widens
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-700">
              Every request starts with donors closest to the hospital. If nobody
              responds in time, the alert reaches further out — and stops as soon
              as help is secured.
            </p>
          </div>
          <RingDiagram />
        </div>

        <ol className="mt-8 grid gap-4 sm:grid-cols-3">
          {phases.map((phase, i) => (
            <li
              key={phase.title}
              className="glass-blood rounded-lg px-5 py-4"
            >
              <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
                {ALERT_RING_LABELS[ALERT_RINGS_KM[i]] ?? `${ALERT_RINGS_KM[i]} km`}
              </p>
              <p className="mt-1 text-base font-bold text-ink-900">{phase.title}</p>
              <p className="mt-1 text-base leading-relaxed text-ink-600">{phase.body}</p>
            </li>
          ))}
        </ol>

      </div>
    </Section>
  );
}
