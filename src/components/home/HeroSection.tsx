import { ButtonLink } from "@/components/ui/Button";

const steps = [
  {
    label: "Request",
    body: "A family member or friend posts what's needed: blood group, hospital, how soon.",
  },
  {
    label: "Match",
    body: "RaktSetu finds willing donors with the right blood group near that hospital.",
  },
  {
    label: "Help arrives",
    body: "A donor shows up at the blood bank. The usual screening happens, as it always has.",
  },
];

/**
 * Homepage hero — big type, one clean panel, normal document flow.
 * No overlapping or floating elements anywhere.
 */
export function HeroSection({ appName }: { appName: string }) {
  return (
    <section className="border-b border-ink-200 bg-ink-50">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[1.1fr_1fr] lg:pb-28">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
            A blood donor network
          </p>
          <h1 className="mt-4 text-5xl font-extrabold leading-[1.05] tracking-tight text-ink-900 sm:text-6xl">
            When blood is needed,
            <br />
            <span className="text-blood-700">reach donors nearby</span>
            <br />— fast.
          </h1>
          <p className="mt-6 max-w-xl text-xl leading-relaxed text-ink-600">
            {appName} connects an urgent blood request with willing donors close by. A
            friend, relative, or volunteer runs the request —{" "}
            <strong className="font-bold text-ink-900">
              the patient never has to touch the app.
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
            Free to use. We don&apos;t sell your data, and we don&apos;t decide who can
            donate — that stays with the blood bank.
          </p>
        </div>

        {/* Single panel in normal flow — three steps, separated by rules. */}
        <div className="rounded-lg border border-ink-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-bold uppercase tracking-widest text-ink-400">
            How it works
          </p>
          <ol className="mt-4">
            {steps.map((s, i) => (
              <li
                key={s.label}
                className={i < steps.length - 1 ? "border-b border-ink-100" : undefined}
              >
                <div className="flex gap-4 py-5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blood-700 text-base font-extrabold text-white">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-lg font-bold text-ink-900">{s.label}</p>
                    <p className="mt-1 text-base leading-relaxed text-ink-600">{s.body}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
