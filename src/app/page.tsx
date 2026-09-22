import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Section } from "@/components/layout/PageHeader";
import { HeroSection } from "@/components/home/HeroSection";
import { APP_NAME } from "@/lib/constants";

const roles = [
  {
    title: "You're arranging blood for someone",
    body: "Create a request with the blood group, hospital, and how soon it's needed. It takes a couple of minutes — the patient doesn't need an account.",
    action: { href: "/request-blood", label: "Request blood" },
  },
  {
    title: "You're willing to donate",
    body: "Sign up once with your blood group and locality. When someone near that area needs your blood type, RaktSetu can match you to the request.",
    action: { href: "/donor", label: "Become a donor" },
  },
  {
    title: "You work at a blood bank",
    body: "Donors who reach you go through your normal screening process. RaktSetu only handles the coordination before that.",
    action: { href: "/admin", label: "How we work with blood banks" },
  },
];

export default function HomePage() {
  return (
    <>
      <HeroSection appName={APP_NAME} />

      <Section>
        <h2 className="text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
          Three kinds of people make this work
        </h2>
        <p className="mt-4 max-w-2xl text-lg text-ink-600">
          Blood is usually needed at the worst possible moment. RaktSetu splits the work
          so no one person has to figure everything out alone.
        </p>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {roles.map((role) => (
            <Card key={role.title} className="flex flex-col">
              <CardHeader>
                <CardTitle>{role.title}</CardTitle>
              </CardHeader>
              <CardBody className="flex flex-1 flex-col justify-between gap-6">
                <p className="text-base leading-relaxed text-ink-600">{role.body}</p>
                <div>
                  <ButtonLink href={role.action.href} variant="secondary">
                    {role.action.label}
                  </ButtonLink>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}
