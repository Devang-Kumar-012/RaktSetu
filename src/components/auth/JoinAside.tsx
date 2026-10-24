import { ALERT_RINGS_KM } from "@/lib/constants";

const roles = [
  { name: "Donor", body: "Get an alert only when a nearby request needs your blood group. Accept or decline — always your call." },
  { name: "Requester", body: "Post a request for a patient and follow the alert ring until a donor accepts." },
  { name: "Volunteer", body: "Help requesters who ask for support with coordination on the ground." },
];

const promises = [
  "Your phone number is never shown publicly",
  `Alerts reach the nearest donors first (${ALERT_RINGS_KM[0]} km)`,
  "Free to use — no fees, ever",
  "The blood bank still screens every donor",
];

/** Side column for the sign-up / log-in pages: what each role does and what we promise. */
export function JoinAside() {
  return (
    <div className="space-y-5">
      <div className="glass rounded-2xl p-6">
        <h2 className="text-base font-bold text-ink-900">Which role is right for you?</h2>
        <dl className="mt-3 space-y-3">
          {roles.map((r) => (
            <div key={r.name}>
              <dt className="text-sm font-bold text-blood-700">{r.name}</dt>
              <dd className="text-sm leading-relaxed text-ink-700">{r.body}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="glass rounded-2xl p-6">
        <h2 className="text-base font-bold text-ink-900">Our promises</h2>
        <ul className="mt-3 space-y-2">
          {promises.map((p) => (
            <li key={p} className="text-sm text-ink-800">
              <span aria-hidden="true" className="font-bold text-blood-700">✓</span> {p}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
