import { ButtonLink } from "@/components/ui/Button";
import { SlotImage } from "@/components/ui/SlotImage";

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
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:pt-20 sm:pb-24 lg:px-8 lg:py-24 lg:pb-32">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-16 items-start lg:items-center">

          {/* LEFT — editorial copy surface */}
          <div className="glass rounded-2xl px-6 py-10 sm:px-10 sm:py-12 lg:px-12 lg:py-16">
            <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
              Emergency blood coordination
            </p>
            <h1 className="mt-4 text-4xl font-extrabold leading-[1.05] tracking-tight text-ink-900 sm:text-5xl lg:text-6xl">
              When blood is needed,{" "}
              <span className="text-blood-700">reach donors nearby</span> — fast.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-600 sm:text-xl">
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
            className="aspect-[4/5] w-full sm:aspect-square lg:max-w-[560px] lg:justify-self-end"
            priority
          />
        </div>
      </div>
    </section>
  );
}