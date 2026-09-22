"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileActionState } from "@/lib/actions/action-state";
import { getSessionInfo } from "@/lib/profile";
import type { DonorAvailability } from "@/types";
import { validateAvailability, validateLocality } from "@/lib/validation";

/** Creates or updates the volunteer profile of the logged-in volunteer. */
export async function updateVolunteerProfile(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const { configured, user, profile } = await getSessionInfo();
  if (!configured || !user) {
    return { ok: false, error: "You need to be logged in to update your volunteer profile." };
  }
  if (profile?.role !== "volunteer") {
    return { ok: false, error: "Only volunteer accounts can have a volunteer profile." };
  }

  const localityRaw = String(formData.get("locality") ?? "").trim();
  const availability = String(formData.get("availability") ?? "").trim();

  const error =
    validateLocality(localityRaw, false) ?? validateAvailability(availability);
  if (error) return { ok: false, error };

  const supabase = await createSupabaseServerClient();
  const { error: dbError } = await supabase.from("volunteer_profiles").upsert(
    {
      user_id: user.id,
      locality: localityRaw === "" ? null : localityRaw,
      availability: availability as DonorAvailability,
    },
    { onConflict: "user_id" }
  );

  if (dbError) {
    console.error("updateVolunteerProfile failed:", dbError.message);
    return { ok: false, error: "Could not save your volunteer profile. Please try again." };
  }

  return { ok: true, error: null, success: "Volunteer profile saved." };
}
