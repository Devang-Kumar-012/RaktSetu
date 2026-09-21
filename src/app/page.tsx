import { ButtonLink } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Section } from "@/components/layout/PageHeader";
import { HeroSection } from "@/components/home/HeroSection";
import { APP_NAME } from "@/lib/constants";

const roles = [
  {
    title: "You have a patient who needs blood",
    body: "A friend, relative, or volunteer creates the request on your behalf — with the hospital and blood group details. You focus on the person, not the app.",
    action: { href: "/request-blood", label: "Request blood" },
  },
  {
    title: "You are willing to donate",
    body: "Register once with your blood group and city. When someone nearby genuinely needs your blood type, you get a clear, actionable notification.",
    action: { href: "/donor", label: "Become a donor" },
  },
  {
    title: "You are a hospital or blood bank",
    body: "Verify requests and record the final screening decision. RaktSetu handles outreach and coordination — medical eligibility always stays with you.",
    action: { href: "/admin", label: "Admin section" },
  },
];

export default function HomePage() {
  return (
    <>
      <HeroSection appName={APP_NAME} />

      <Section>
        <h2 className="text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
          Built for the people around the patient
        </h2>
        <p className="mt-4 max-w-2xl text-lg text-ink-600">
          Blood is needed at the worst possible moment. {APP_NAME} splits the work so
          nobody has to figure out an app alone.
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
