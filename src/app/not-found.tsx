import { Section } from "@/components/layout/PageHeader";
import { ButtonLink } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <Section className="text-center">
      <p className="text-sm font-bold uppercase tracking-widest text-blood-700">404</p>
      <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-ink-900 sm:text-5xl">
        This page went missing
      </h1>
      <p className="mx-auto mt-4 max-w-md text-lg text-ink-600">
        The link may be old or mistyped. The homepage is the best place to restart.
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <ButtonLink href="/">Back to home</ButtonLink>
        <ButtonLink href="/contact" variant="secondary">Get help</ButtonLink>
      </div>
    </Section>
  );
}
