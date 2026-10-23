import { cn } from "@/lib/cn";
import { Card, CardBody } from "@/components/ui/Card";

/**
 * THE DONOR MOTIVATION MESSAGE.
 *
 * One component, used on both the "become a donor" page and the donor profile
 * form, so the words a first-time donor reads and the words they read while
 * filling in their details can never drift apart.
 *
 * WHAT THE COPY DELIBERATELY DOES NOT SAY
 *
 * Nothing here promises an outcome. It does not claim a donation will save a
 * life, that blood is always safe, or that it reaches any particular patient —
 * a donor cannot know that, and saying so would be the kind of claim that
 * erodes trust the moment reality is more complicated.
 *
 * What it does do is name what RaktSetu actually does (it coordinates willing
 * donors with people who urgently need blood) and where the medical process
 * lives (collection, screening, storage and transfusion, with qualified
 * professionals). That split is the whole point: the app is the introduction,
 * the blood bank is the care.
 */
export function DonorMotivation({
  glass = true,
  className,
}: {
  glass?: boolean;
  className?: string;
}) {
  return (
    <Card
      glass={glass}
      className={cn(!glass && "border-blood-200 bg-blood-50/60", className)}
    >
      <CardBody className="pt-6">
        <h2 className="text-xl font-extrabold tracking-tight text-ink-900 sm:text-2xl">
          Your donation can make a difference.
        </h2>
        <p className="mt-3 text-base leading-relaxed text-ink-700 sm:text-lg">
          RaktSetu brings willing donors together with people who urgently need
          blood, and alerts you only when your blood group and area match.
        </p>
        <p className="mt-3 text-base leading-relaxed text-ink-700 sm:text-lg">
          From there, collection, screening, storage and transfusion stay with
          qualified blood-bank and medical staff. We help the right people find
          each other quickly — they take it from there.
        </p>
      </CardBody>
    </Card>
  );
}
