import { Section } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";

const canDo = [
  "See emergency requests in the area and help spread the word.",
  "Coordinate with a requester who has asked for assistance.",
  "Keep their own availability and contact details up to date.",
];

const cannotDo = [
  "Decide who is medically fit to donate — that is the blood bank's call.",
  "Accept a request on a donor's behalf or contact donors directly.",
  "Change a request's status, edit donation records, or alter platform settings.",
];

/**
 * Volunteer section.
 *
 * The wording is the important part: it states the limits explicitly, because
 * "volunteer" otherwise reads as a vaguely authoritative support role. Nothing
 * here implies medical or administrative authority.
 */
export function VolunteerSection() {
  return (
    <section className="border-y border-ink-200 bg-white">
      <Section>
        <div className="max-w-3xl">
          <p className="text-sm font-bold uppercase tracking-widest text-blood-700">
            For volunteers
          </p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
            Help with coordination, not with medicine
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-ink-600">
            Volunteers see emergency requests that may benefit from extra
            coordination and help a requester who has asked for support. The role
            is deliberately narrow so nobody is ever left guessing what they are
            authorised to do.
          </p>
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          <div className="rounded-lg border border-green-200 bg-green-50 p-6">
            <h3 className="text-lg font-bold text-green-900">What you can do</h3>
            <ul className="mt-3 space-y-2">
              {canDo.map((item) => (
                <li key={item} className="text-base leading-relaxed text-green-900">
                  <span aria-hidden="true" className="font-bold">
                    ✓
                  </span>{" "}
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-ink-200 bg-ink-50 p-6">
            <h3 className="text-lg font-bold text-ink-900">What you cannot do</h3>
            <ul className="mt-3 space-y-2">
              {cannotDo.map((item) => (
                <li key={item} className="text-base leading-relaxed text-ink-700">
                  <span aria-hidden="true" className="font-bold text-ink-500">
                    ✕
                  </span>{" "}
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-4">
          <ButtonLink href="/register?role=volunteer" size="lg">
            Volunteer with RaktSetu
          </ButtonLink>
        </div>
      </Section>
    </section>
  );
}
