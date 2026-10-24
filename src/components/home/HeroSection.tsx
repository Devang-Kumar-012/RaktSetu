import { ButtonLink } from "@/components/ui/Button";
import { SlotImage } from "@/components/ui/SlotImage";
import { ALERT_RINGS_KM, ALERT_WINDOW_MINUTES } from "@/lib/constants";
import { DONATION_INTERVAL_LABEL } from "@/lib/donation-config";

/**
 * Homepage hero — two-column editorial layout.
 *
 * Left: eyebrow, headline with highlighted phrase, one short supporting line,
 * primary and secondary actions.
 *
 * Right: one large photograph in a rounded frame.
 */
export function HeroSection({ appName }: { appName: string }) {
  return (
    <section className="border-b border-ink-200 hero-wash">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-14">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-10 items-start lg:items-stretch">

          {/* LEFT — editorial copy surface */}
          <div className="glass rounded-2xl px-6 py-10 sm:px-10 sm:py-10 lg:px-12 lg:py-12">
            <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
              Emergency blood coordination
            </p>
            <h1 className="mt-4 text-4xl font-extrabold leading-[1.05] tracking-tight text-ink-900 sm:text-5xl">
              When blood is needed,{" "}
              <span className="text-blood-700">reach donors nearby</span> — fast.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-600 sm:text-lg">
              A friend, relative, or volunteer creates the request while you stay
              with the patient. Nearby matching donors are alerted straight away.
            </p>

            <div className="mt-10 flex flex-wrap gap-4">
              <ButtonLink href="/request-blood" size="lg">
                Request blood
              </ButtonLink>
              <ButtonLink href="/donor" variant="secondary" size="lg">
                Become a donor
              </ButtonLink>
            </div>

            <p className="mt-8 text-sm text-ink-500">
              Free to use. Eligibility and screening stay with the blood bank.
            </p>
          </div>

          {/* RIGHT — one large photograph in a rounded frame */}
          <SlotImage
            slot="hero"
            sizes="(max-width: 1023px) 92vw, 560px"
            className="aspect-[4/5] w-full sm:aspect-square lg:aspect-auto lg:h-full"
            priority
          />
        </div>

        {/* How the platform behaves, in numbers taken from the same constants the alert engine uses. */}
        <dl className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            [ALERT_RINGS_KM.map((km) => `${km}`).join(" → ") + " km", "Alert rings, nearest donors first"],
            [`${ALERT_WINDOW_MINUTES} min`, "Wait per ring before the search widens"],
            ["0", "Phone numbers ever shown publicly"],
            [DONATION_INTERVAL_LABEL, "Rest gap respected for every donor"],
          ].map(([value, label]) => (
            <div key={label} className="glass rounded-xl px-5 py-4">
              <dt className="sr-only">{label}</dt>
              <dd className="text-2xl font-extrabold text-blood-700">{value}</dd>
              <dd className="mt-1 text-sm text-ink-600">{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}