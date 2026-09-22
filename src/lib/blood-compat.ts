/**
 * Blood-group compatibility rules — APPLICATION-LEVEL FILTER ONLY.
 *
 * ⚠️ This is not medical advice and never decides eligibility. The blood
 * bank's screening is always authoritative. These rules only decide which
 * donors the matching system may notify, to keep alerts relevant.
 *
 * Must stay in sync with public.blood_groups_compatible() in
 * supabase/migrations/0005_matching_function.sql. Have the final rules
 * verified with an authorized blood bank or Red Cross professional.
 */

import { BLOOD_GROUPS } from "@/lib/constants";
import type { BloodComponent } from "@/types";

/** ABO part of a group string, e.g. "A" from "A+". */
function aboPart(group: string): string {
  return group.slice(0, -1);
}

/** Rh part of a group string, e.g. "+" from "A+". */
function rhPart(group: string): string {
  return group.slice(-1);
}

/**
 * Whether a donor's blood group may be matched to a recipient group for the
 * given component.
 *
 * Whole blood — standard ABO/Rh matrix:
 *   Rh− donors work for everyone; Rh+ donors only for Rh+ recipients.
 *   O donates to any ABO group; AB receives from any ABO; otherwise ABO must
 *   match.
 *
 * Platelets — deliberately conservative:
 *   ABO-identical only. An Rh− donor may match an Rh+ recipient; an Rh+ donor
 *   never matches an Rh− recipient.
 *
 * `component` is typed as a plain string on purpose: unknown or future
 * components must resolve to `false` (never a silent fallback to whole-blood
 * rules), exactly like public.blood_groups_compatible() in the database.
 */
export function isBloodCompatible(
  donorGroup: string,
  recipientGroup: string,
  component: string
): boolean {
  if (!(BLOOD_GROUPS as readonly string[]).includes(donorGroup)) return false;
  if (!(BLOOD_GROUPS as readonly string[]).includes(recipientGroup)) return false;
  if (component !== "whole_blood" && component !== "platelets") return false;

  const donorAbo = aboPart(donorGroup);
  const recipientAbo = aboPart(recipientGroup);
  const donorRh = rhPart(donorGroup);
  const recipientRh = rhPart(recipientGroup);

  if (component === "platelets") {
    return (
      donorAbo === recipientAbo && (donorRh === "-" || donorRh === recipientRh)
    );
  }

  const rhOk = donorRh === "-" || donorRh === recipientRh;
  const aboOk =
    donorAbo === "O" || recipientAbo === "AB" || donorAbo === recipientAbo;
  return rhOk && aboOk;
}

/** All recipient groups a donor of the given group can be matched to. */
export function getCompatibleRecipientGroups(
  donorGroup: string,
  component: BloodComponent
): string[] {
  return BLOOD_GROUPS.filter((g) => isBloodCompatible(donorGroup, g, component));
}
