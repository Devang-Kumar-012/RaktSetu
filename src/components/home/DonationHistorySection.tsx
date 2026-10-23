import { Section } from "@/components/layout/PageHeader";
import { BLOOD_COMPONENT_LABELS } from "@/lib/constants";
import { getPublicImpact } from "@/lib/server/public-impact";

const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Donation history wall: completed donations recorded by admins, shown
 * anonymously (blood group, component, locality, month). Hidden until there is
 * at least one real record, so the homepage never shows invented outcomes.
 */
export async function DonationHistorySection() {
  const impact = await getPublicImpact();
  if (!impact || impact.totalDonations === 0) return null;

  return (
    <Section>
      <div className="glass rounded-lg p-6 sm:p-10">
        <p className="text-sm font-bold uppercase tracking-widest text-blood-700">Donation history</p>
        <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
          Blood that already reached someone
        </h2>
        <p className="mt-4 max-w-3xl text-lg leading-relaxed text-ink-700">
          Every entry below is a completed donation confirmed by a blood bank or RaktSetu admin. Donors and
          patients stay anonymous.
        </p>

        <dl className="mt-6 flex flex-wrap gap-8">
          <div>
            <dt className="text-sm font-semibold text-ink-700">Donations completed</dt>
            <dd className="text-4xl font-extrabold text-blood-700">{impact.totalDonations}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-ink-700">Units of blood given</dt>
            <dd className="text-4xl font-extrabold text-blood-700">{impact.totalUnits}</dd>
          </div>
        </dl>

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
      </div>
    </Section>
  );
}
