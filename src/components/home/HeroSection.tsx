import { ButtonLink } from "@/components/ui/Button";
import { ALERT_RING_LABELS, ALERT_RINGS_KM } from "@/lib/constants";

/**
 * Homepage hero — a glass content surface and a glass ring-diagram panel,
 * both in normal document flow over the emergency-themed wash.
 * No overlapping or floating elements anywhere.
 */
export function HeroSection({ appName }: { appName: string }) {
  return (
    <section className="border-b border-ink-200 hero-wash">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[1.15fr_1fr] lg:gap-14 lg:pb-24">
        {/* Glass content surface — normal flow, full text contrast. */}
        <div className="glass rounded-xl px-6 py-10 sm:px-10 sm:py-12">
          <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
            Emergency blood coordination
          </p>
          <h1 className="mt-4 text-4xl font-extrabold leading-[1.06] tracking-tight text-ink-900 sm:text-5xl lg:text-6xl">
            When blood is needed,{" "}
            <span className="text-blood-700">reach donors nearby</span> — fast.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-600 sm:text-xl">
            {appName} connects an urgent blood request with willing, compatible
            donors close to the hospital — so coordination starts in minutes,
            not hours. A friend, relative, or volunteer runs the whole request;{" "}
            <strong className="font-bold text-ink-900">
              the patient never has to use the platform themselves.
            </strong>
          </p>

          <div className="mt-8 flex flex-wrap gap-4">
            <ButtonLink href="/request-blood" size="lg">
              Request blood
            </ButtonLink>
            <ButtonLink href="/donor" variant="secondary" size="lg">
              Become a donor
            </ButtonLink>
          </div>

          <p className="mt-6 text-base text-ink-600">
            Free to use. RaktSetu coordinates the search — eligibility and
            screening always stay with the blood bank.
          </p>
        </div>

        {/* Ring diagram panel — shows the widening search at a glance. */}
        <div className="glass rounded-xl p-6 sm:p-8">
          <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
            The search widens only when it must
          </p>

          <div className="mt-6 flex justify-center">
            <div
              aria-hidden="true"
              className="flex h-52 w-52 items-center justify-center rounded-full border-2 border-blood-200 sm:h-64 sm:w-64"
            >
              <div className="flex h-32 w-32 items-center justify-center rounded-full border-2 border-blood-300 sm:h-40 sm:w-40">
                <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-blood-400 sm:h-24 sm:w-24">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blood-700 text-white shadow-md sm:h-14 sm:w-14">
                    <svg viewBox="0 0 24 24" className="h-6 w-6 sm:h-7 sm:w-7" fill="currentColor">
                      <path d="M12 2.5C12 2.5 5.5 10 5.5 14.6a6.5 6.5 0 0 0 13 0C18.5 10 12 2.5 12 2.5Z" />
                    </svg>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <ul className="mt-6 flex flex-wrap justify-center gap-2">
            {ALERT_RINGS_KM.map((km) => (
              <li
                key={km}
                className="rounded-full border border-ink-200 bg-white px-3 py-1 text-sm font-bold text-ink-800"
              >
                {ALERT_RING_LABELS[km] ?? `${km} km`}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-center text-base text-ink-600">
            Nearby donors first — wider only if nobody responds in time.
          </p>
        </div>
      </div>
    </section>
  );
}
