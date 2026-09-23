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
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <p className="text-sm font-bold uppercase tracking-widest text-blood-200">
            Need blood right now?
          </p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Post the request — take the first step in minutes
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-blood-100">
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
      </div>
    </section>
  );
}
