"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileActionState } from "@/lib/actions/action-state";
import { getSessionInfo } from "@/lib/profile";
import type { DonorAvailability } from "@/types";
import {
  validateAvailability,
  validateBloodGroup,
  validateLastDonationDate,
  validateLocality,
  validatePhone,
} from "@/lib/validation";
import { parseCoordInput, roundCoord } from "@/lib/geo";

/**
 * Creates or updates the donor profile of the logged-in donor.
 * Server-side role check + validation + RLS all apply; the client form
 * is never trusted. donation_count is intentionally not writable.
 *
 * Optional approximate coordinates arrive as a "coordsChoice" value of
 * "lat:lng" (from the locality lookup candidates). They are validated,
 * rounded to ~1 km, and stored ONLY when provided — a normal profile save
 * without a chosen candidate never touches existing coordinates.
 */
export async function updateDonorProfile(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const { configured, user, profile } = await getSessionInfo();
  if (!configured || !user) {
    return { ok: false, error: "You need to be logged in to update your donor profile." };
  }
  if (profile?.role !== "donor") {
    return { ok: false, error: "Only donor accounts can have a donor profile." };
  }

  const bloodGroup = String(formData.get("bloodGroup") ?? "").trim();
  const locality = String(formData.get("locality") ?? "").trim();
  const lastDonationDate = String(formData.get("lastDonationDate") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const availability = String(formData.get("availability") ?? "").trim();

  const error =
    validateBloodGroup(bloodGroup) ??
    validateLocality(locality) ??
    validatePhone(phone) ??
    validateLastDonationDate(lastDonationDate) ??
    validateAvailability(availability);
  if (error) return { ok: false, error };

  // Optional approximate location ("lat:lng" from a chosen lookup candidate).
  // Malformed values are ignored, never trusted.
  const coordsRaw = String(formData.get("coordsChoice") ?? "").trim();
  const coordsUpdate: { latitude: number; longitude: number } | null = (() => {
    if (coordsRaw === "") return null;
    const [latRaw, lngRaw] = coordsRaw.split(":");
    const lat = parseCoordInput(latRaw, "lat");
    const lng = parseCoordInput(lngRaw, "lng");
    if (!lat.ok || !lng.ok || lat.value === null || lng.value === null) return null;
    return { latitude: roundCoord(lat.value), longitude: roundCoord(lng.value) };
  })();

  const supabase = await createSupabaseServerClient();
  const { error: dbError } = await supabase.from("donor_profiles").upsert(
    {
      user_id: user.id,
      blood_group: bloodGroup,
      locality,
      phone,
      availability: availability as DonorAvailability,
      last_donation_date: lastDonationDate === "" ? null : lastDonationDate,
      ...(coordsUpdate ?? {}),
    },
    { onConflict: "user_id" }
  );

  if (dbError) {
    console.error("updateDonorProfile failed:", dbError.message);
    return { ok: false, error: "Could not save your donor profile. Please try again." };
  }

  return { ok: true, error: null, success: "Donor profile saved." };
}
