import Link from "next/link";

import { Section } from "@/components/layout/PageHeader";
import { getCompatibleRecipientGroups } from "@/lib/blood-compat";
import { BLOOD_GROUPS } from "@/lib/constants";
import { DONATION_INTERVAL_LABEL } from "@/lib/donation-config";

const points = [
  "You stay in control — pause availability whenever you need to.",
  "Your phone number stays private and is never listed anywhere.",
  "Screening doesn't change — the blood bank decides, as it always has.",
];

// General NBTC (India) guidance a donor can check before signing up; the blood bank still screens on the day.
const basics = [
  ["Age", "18 – 65 years"],
  ["Weight", "45 kg or more"],
  ["Haemoglobin", "12.5 g/dL or more"],
  ["Gap since last donation", DONATION_INTERVAL_LABEL],
];

/**
 * Donor invitation: why to join, who can donate, and who your blood can reach.
 * The compatibility chart comes from the same rules the matching engine uses.
 */
export function DonorSection() {
  return (
    <Section>
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-blood-700">For donors</p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
            Be the person nearby who can help
          </h2>
          <p className="mt-4 text-base leading-relaxed text-ink-600">
            Register once with your blood group and area. When a nearby request needs your type, the alert
            reaches you — and every time, the choice is yours.
          </p>
          <ul className="mt-5 space-y-2">
            {points.map((point) => (
              <li key={point} className="text-base text-ink-800">
                <span aria-hidden="true" className="font-bold text-blood-700">✓</span> {point}
              </li>
            ))}
          </ul>

          <div className="mt-6 rounded-lg border border-ink-200 bg-white/70 p-5">
            <h3 className="text-base font-bold text-ink-900">Can I donate? The basics</h3>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
              {basics.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-ink-600">{label}</dt>
                  <dd className="font-bold text-ink-900">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm text-ink-600">
              The blood bank checks you again on the day.{" "}
              <Link href="/donor" className="font-semibold text-blood-700 underline underline-offset-4">
                Read the donor guide
              </Link>
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-ink-200 bg-white/70 p-5 sm:p-6">
          <h3 className="text-base font-bold text-ink-900">Who your blood can reach</h3>
          <p className="mt-1 text-sm text-ink-600">Red cells / whole blood. The final cross-match is always done by the blood bank.</p>
          <table className="mt-4 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-200 text-sm text-ink-600">
                <th className="py-2 pr-3 font-semibold">Your group</th>
                <th className="py-2 font-semibold">Can give to</th>
              </tr>
            </thead>
            <tbody>
              {BLOOD_GROUPS.map((group) => {
                const recipients = getCompatibleRecipientGroups(group, "whole_blood");
                return (
                  <tr key={group} className="border-b border-ink-100 last:border-0">
                    <td className="py-2 pr-3">
                      <span className="inline-block min-w-11 rounded-md bg-blood-50 px-2 py-1 text-center font-extrabold text-blood-700">
                        {group}
                      </span>
                    </td>
                    <td className="py-2 text-sm text-ink-800">
                      {recipients.length === BLOOD_GROUPS.length ? (
                        <span className="font-bold text-blood-700">Everyone — universal donor</span>
                      ) : (
                        recipients.join(", ")
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}
