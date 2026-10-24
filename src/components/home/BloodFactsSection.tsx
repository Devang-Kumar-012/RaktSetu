import { Section } from "@/components/layout/PageHeader";

// Widely published, general blood-donation facts (NBTC / WHO guidance); no platform statistics here.
const facts = [
  {
    value: "Up to 3",
    title: "patients from one donation",
    body: "A unit of whole blood is separated into red cells, plasma and platelets, each going to a different patient.",
  },
  {
    value: "5 days",
    title: "is all platelets last",
    body: "Platelets can't be stockpiled, which is why dengue season and cancer wards keep running short.",
  },
  {
    value: "~10 min",
    title: "for the donation itself",
    body: "Registration, a quick check-up and rest take the visit to under an hour.",
  },
  {
    value: "350 – 450 ml",
    title: "is one donation",
    body: "An adult has around 5 litres of blood; the body replaces the volume within a day or two.",
  },
  {
    value: "3 – 4 months",
    title: "between whole-blood donations",
    body: "Indian guidelines ask men to wait 3 months and women 4 months, so the body fully recovers.",
  },
  {
    value: "Every O−",
    title: "donor is precious",
    body: "O-negative red cells can go to anyone in an emergency before the patient's group is known.",
  },
];

/** "Why it matters" band: general donation facts that give context to everything the platform does. */
export function BloodFactsSection() {
  return (
    <Section>
      <p className="text-sm font-bold uppercase tracking-widest text-blood-700">Why every donation matters</p>
      <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
        Blood can&apos;t be made in a factory — only given
      </h2>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-600">
        Hospitals depend on people walking in to donate. A few facts that explain why speed and nearness matter.
      </p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map((f) => (
          <li key={f.title} className="glass rounded-lg p-5">
            <p className="text-2xl font-extrabold text-blood-700">{f.value}</p>
            <p className="font-bold text-ink-900">{f.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">{f.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
