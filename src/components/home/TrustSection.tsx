import { Section } from "@/components/layout/PageHeader";

const safeguards = [
  {
    title: "Contact details stay private",
    body: "Phone numbers are never listed publicly. The requester and the accepted donor see each other's number only after acceptance, and only until the response window closes.",
  },
  {
    title: "Matching follows clear rules",
    body: "Blood group compatibility, availability, the donation interval, and distance decide who gets alerted — nothing else, and no guesswork.",
  },
  {
    title: "Requests have an end",
    body: "Every request carries a deadline. Fulfil it, cancel it, or let it expire, and alerting stops immediately — donors aren't chased for help that is no longer needed.",
  },
  {
    title: "Screening stays professional",
    body: "RaktSetu never decides who is medically fit to donate. That judgment always belongs to the blood bank's staff, as it always has.",
  },
];

/**
 * Trust & privacy safeguards — solid surfaces on purpose (this is dense,
 * important copy) plus an explicit no-guarantee line.
 */
export function TrustSection() {
  return (
    <section className="border-y border-ink-200 bg-white">
      <Section>
        <h2 className="text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
          Built to protect everyone involved
        </h2>
        <p className="mt-4 max-w-2xl text-lg text-ink-600">
          An emergency is the worst time to worry about who sees your number —
          or who is making the decisions. Here is where the line sits.
        </p>

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {safeguards.map((item) => (
            <div key={item.title} className="rounded-lg bg-ink-50 p-6">
              <h3 className="text-lg font-bold text-ink-900">{item.title}</h3>
              <p className="mt-2 text-base leading-relaxed text-ink-600">{item.body}</p>
            </div>
          ))}
        </div>

        <p className="mt-8 max-w-3xl text-base text-ink-600">
          RaktSetu coordinates the search — it cannot guarantee that blood will
          be found. Final eligibility and screening are always the blood bank&apos;s
          decision.
        </p>
      </Section>
    </section>
  );
}
