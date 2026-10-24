import { Section } from "@/components/layout/PageHeader";
import { BLOOD_COMPONENT_LABELS } from "@/lib/constants";
import { SAMPLE_DONORS } from "@/lib/demo-showcase";
import { getPublicImpact } from "@/lib/server/public-impact";

const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Donation history wall for every visitor. Shows real completed donations
 * recorded by admins (anonymous: blood group, component, locality, month).
 * Until the first real one exists, it shows clearly labelled sample donor
 * profiles instead, so the homepage is never empty and never passes samples off as real.
 */
export async function DonationHistorySection() {
  const impact = await getPublicImpact();
  const real = impact !== null && impact.totalDonations > 0;

  return (
    <Section>
      <div className="glass rounded-lg p-6 sm:p-10">
        <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
          {real ? "Donation history" : "Our donors"}
          {!real && (
            <span className="ml-3 rounded-full bg-ink-100 px-2.5 py-1 text-xs tracking-normal text-ink-700 normal-case">
              Sample profiles
            </span>
          )}
        </p>
        <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
          {real ? "Blood that already reached someone" : "People who show up when it matters"}
        </h2>
        <p className="mt-4 max-w-3xl text-lg leading-relaxed text-ink-700">
          {real
            ? "Every entry below is a completed donation confirmed by a blood bank or RaktSetu admin. Donors and patients stay anonymous."
            : "Donors across Delhi NCR answer RaktSetu alerts for emergencies, mothers after childbirth, thalassemia and campus drives."}
        </p>

        <dl className="mt-6 flex flex-wrap gap-8">
          <div>
            <dt className="text-sm font-semibold text-ink-700">{real ? "Donations completed" : "Donations by these donors"}</dt>
            <dd className="text-4xl font-extrabold text-blood-700">
              {real ? impact.totalDonations : SAMPLE_DONORS.reduce((n, d) => n + d.donations, 0)}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-ink-700">{real ? "Units of blood given" : "Blood groups covered"}</dt>
            <dd className="text-4xl font-extrabold text-blood-700">
              {real ? impact.totalUnits : new Set(SAMPLE_DONORS.map((d) => d.bloodGroup)).size}
            </dd>
          </div>
        </dl>

        {real ? (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {impact.recent.map((d, i) => (
              <li key={i} className="flex items-center gap-4 rounded-lg border border-ink-200 bg-white/70 p-4">
                <span className="flex h-14 w-12 shrink-0 items-center justify-center rounded-xl bg-blood-50 text-lg font-extrabold text-blood-700">
                  {d.blood_group ?? "🩸"}
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-ink-900">
                    {d.units} unit{d.units === 1 ? "" : "s"} of {BLOOD_COMPONENT_LABELS[d.blood_component] ?? d.blood_component}
                  </p>
                  <p className="truncate text-sm text-ink-700">
                    {d.drive_title ? `Campus drive · ${d.drive_title}` : d.locality ? `Emergency request · ${d.locality}` : "Emergency request"}
                  </p>
                  <p className="text-sm text-ink-700">{monthLabel.format(new Date(`${d.month}-01T00:00:00Z`))}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {SAMPLE_DONORS.map((d) => (
                <li key={d.name} className="rounded-lg border border-ink-200 bg-white/70 p-5">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink-900 text-base font-bold text-white"
                    >
                      {d.name.split(" ").map((p) => p[0]).join("")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold leading-tight text-ink-900">{d.name}</p>
                      <p className="text-sm text-ink-700">{d.age} yrs</p>
                    </div>
                    <span className="rounded-xl bg-blood-50 px-2.5 py-1.5 text-base font-extrabold text-blood-700">{d.bloodGroup}</span>
                  </div>
                  <p className="mt-3 text-sm text-ink-700">📍 {d.locality}</p>
                  <p className="mt-4 text-sm text-ink-800">
                    <span className="font-bold">{d.donations} donations</span> · last in {d.lastDonated}
                  </p>
                  <p className="mt-1 text-sm text-ink-700">Helped: {d.helpedWith}</p>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-ink-700">
              Sample profiles shown during RaktSetu&apos;s pilot. Real donors&apos; names and contact details are never shown publicly.
            </p>
          </>
        )}
      </div>
    </Section>
  );
}
