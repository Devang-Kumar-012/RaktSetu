import { ButtonLink } from "@/components/ui/Button";

/**
 * Homepage hero — the single place using the depth/3D treatment:
 * layered cards with rotation, perspective, large foreground typography
 * with a subtle text shadow, and blurred colour fields.
 */
export function HeroSection({ appName }: { appName: string }) {
  return (
    <section className="relative overflow-hidden border-b border-ink-200 bg-ink-50">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 right-[-10%] h-[480px] w-[480px] rounded-full bg-blood-100 opacity-70 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-140px] left-[-8%] h-[380px] w-[380px] rounded-full bg-blood-50 blur-3xl"
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[1.15fr_1fr] lg:pb-28">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
            A live blood-donor network
          </p>
          <h1 className="mt-4 text-5xl font-extrabold leading-[1.05] tracking-tight text-ink-900 sm:text-6xl [text-shadow:0_1px_0_rgba(255,255,255,0.8)]">
            The right blood,
            <br />
            <span className="text-blood-700">reaches the right person</span>
            <br />— in time.
          </h1>
          <p className="mt-6 max-w-xl text-xl leading-relaxed text-ink-600">
            When blood is urgently needed, {appName} reaches willing donors nearby.
            Friends, family, volunteers, or hospital staff run the request —{" "}
            <strong className="font-bold text-ink-900">
              the patient never has to use the app themselves.
            </strong>
          </p>

          <div className="mt-9 flex flex-wrap gap-4">
            <ButtonLink href="/request-blood" size="lg">
              Find blood / Request blood
            </ButtonLink>
            <ButtonLink href="/donor" variant="secondary" size="lg">
              Become a donor
            </ButtonLink>
          </div>

          <p className="mt-6 text-base text-ink-400">
            Free to use. No patient data sold, no eligibility decisions made by software.
          </p>
        </div>

        {/* Layered stack visual — request → alert → help arrives. */}
        <div className="relative hidden min-h-[420px] lg:block [perspective:1400px]" aria-hidden>
          <div className="absolute right-0 top-6 w-80 rotate-[4deg] rounded-lg border border-ink-200 bg-white p-6 shadow-xl">
            <p className="text-xs font-bold uppercase tracking-widest text-ink-400">
              Step 1 · Request
            </p>
            <p className="mt-2 text-lg font-bold text-ink-900">O− needed, City Hospital</p>
            <p className="mt-1 text-base text-ink-600">Posted by a family member</p>
          </div>
          <div className="absolute left-6 top-28 w-80 -rotate-[3deg] rounded-lg border border-blood-200 bg-blood-50 p-6 shadow-2xl">
            <p className="text-xs font-bold uppercase tracking-widest text-blood-700">
              Step 2 · Nearby donors alerted
            </p>
            <p className="mt-2 text-lg font-bold text-ink-900">6 compatible donors within 5 km</p>
            <p className="mt-1 text-base text-ink-600">Notified instantly, no spam</p>
          </div>
          <div className="absolute bottom-0 right-10 w-80 rotate-[2deg] rounded-lg border border-ink-200 bg-white p-6 shadow-xl">
            <p className="text-xs font-bold uppercase tracking-widest text-green-700">
              Step 3 · Help arrives
            </p>
            <p className="mt-2 text-lg font-bold text-ink-900">Donor confirmed for 4 PM</p>
            <p className="mt-1 text-base text-ink-600">Screening at the blood bank, as always</p>
          </div>
        </div>
      </div>
    </section>
  );
}
