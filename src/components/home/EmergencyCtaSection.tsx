import Link from "next/link";

import { ButtonLink } from "@/components/ui/Button";

/**
 * Final emergency call-to-action — a deep blood-gradient band leading
 * straight into the existing request-blood flow. High contrast by design:
 * white text and a solid white button on the darkest surface on the page.
 */
export function EmergencyCtaSection() {
  return (
    <section className="emergency-cta border-y border-blood-950 bg-[linear-gradient(135deg,#8b1d1d_0%,#741d1d_50%,#3d0a0a_100%)]">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[3fr_2fr] lg:items-center">
        <div className="max-w-2xl">
          <p className="text-sm font-bold uppercase tracking-widest text-blood-200">
            Need blood right now?
          </p>
          <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            Post the request — take the first step in minutes
          </h2>
          <p className="mt-4 text-base leading-relaxed text-blood-100">
            A friend, relative, or volunteer can create the request while you
            stay with the patient. Nearby matching donors are alerted straight
            away, and the patient never needs an account.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-6">
            <ButtonLink href="/request-blood" size="lg" variant="secondary">
              Request blood now
            </ButtonLink>
            <Link
              href="/contact"
              className="text-base font-semibold text-white underline underline-offset-4 hover:text-blood-100"
            >
              Questions first? Contact us
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-white/15 bg-white/10 p-6">
          <p className="text-sm font-bold uppercase tracking-widest text-blood-200">In an emergency</p>
          <ol className="mt-4 space-y-3">
            {[
              "Tell the hospital's blood bank first — they know what's in stock.",
              "Post the request on RaktSetu so nearby donors are alerted.",
              "Ask family and friends who can donate to come to the hospital.",
            ].map((step, i) => (
              <li key={step} className="flex gap-3 text-sm leading-relaxed text-blood-50">
                <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-extrabold text-blood-800">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
