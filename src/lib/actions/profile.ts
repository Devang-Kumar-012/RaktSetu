"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileActionState } from "@/lib/actions/action-state";
import { getSessionInfo } from "@/lib/profile";
import { validateFullName } from "@/lib/validation";

/** Updates the authenticated user's display name on their own profile row. */
export async function updateFullName(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const { configured, user, profile } = await getSessionInfo();
  if (!configured || !user) {
    return { ok: false, error: "You need to be logged in to update your profile." };
  }
  if (!profile) {
    return {
      ok: false,
      error: "Your profile is still being set up. Please try again shortly.",
    };
  }

  const fullName = String(formData.get("fullName") ?? "");
  const error = validateFullName(fullName);
  if (error) return { ok: false, error };

  // RLS also restricts this update to the user's own row.
  const supabase = await createSupabaseServerClient();
  const { error: dbError } = await supabase
    .from("profiles")
    .update({ full_name: fullName.trim() })
    .eq("id", user.id);

  if (dbError) {
    console.error("updateFullName failed:", dbError.message);
    return { ok: false, error: "Could not save your name. Please try again." };
  }

  return { ok: true, error: null, success: "Your name has been updated." };
}
