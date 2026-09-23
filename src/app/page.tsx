import { HeroSection } from "@/components/home/HeroSection";
import { HowItWorksSection } from "@/components/home/HowItWorksSection";
import { EmergencyAlertSection } from "@/components/home/EmergencyAlertSection";
import { TrustSection } from "@/components/home/TrustSection";
import { DonorSection } from "@/components/home/DonorSection";
import { EmergencyCtaSection } from "@/components/home/EmergencyCtaSection";
import { APP_NAME } from "@/lib/constants";

/**
 * Homepage — hero, workflow, emergency alert explainer, trust & privacy,
 * donor invitation, and the final emergency CTA. Every link points at an
 * existing public route: /request-blood, /donor, /register, /contact.
 */
export default function HomePage() {
  return (
    <>
      <HeroSection appName={APP_NAME} />
      <HowItWorksSection />
      <EmergencyAlertSection />
      <TrustSection />
      <DonorSection />
      <EmergencyCtaSection />
    </>
  );
}
