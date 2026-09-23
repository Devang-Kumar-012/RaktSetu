"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProfileActionState } from "@/lib/actions/action-state";
import { getSessionInfo } from "@/lib/profile";
import type { DonorAvailability } from "@/types";
import {
  validateAvailability,
  validateLocality,
  validatePhone,
  validateAssistanceNote,
} from "@/lib/validation";

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
  const phoneRaw = String(formData.get("phone") ?? "").trim();

  const error =
    validateLocality(localityRaw, false) ??
    validateAvailability(availability) ??
    (phoneRaw === "" ? null : validatePhone(phoneRaw));
  if (error) return { ok: false, error };

  const supabase = await createSupabaseServerClient();
  const { error: dbError } = await supabase.from("volunteer_profiles").upsert(
    {
      user_id: user.id,
      locality: localityRaw === "" ? null : localityRaw,
      availability: availability as DonorAvailability,
      phone: phoneRaw === "" ? null : phoneRaw,
    },
    { onConflict: "user_id" }
  );

  if (dbError) {
    console.error("updateVolunteerProfile failed:", dbError.message);
    return { ok: false, error: "Could not save your volunteer profile. Please try again." };
  }

  return { ok: true, error: null, success: "Volunteer profile saved." };
}

/* ------------------------------------------------------------------------ */
/* Request coordination                                                      */
/* ------------------------------------------------------------------------ */

function isUuid(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

/**
 * Server-side guard: the caller must be an ACTIVE volunteer. Authorization
 * is never left to the UI; the database functions re-check the role too.
 */
type VolunteerGuard = { error: string; userId?: undefined } | { error?: undefined; userId: string };

async function requireActiveVolunteer(): Promise<VolunteerGuard> {
  const session = await getSessionInfo();
  if (!session.configured || !session.user || !session.profile) {
    return { error: "Please log in as a volunteer to coordinate requests." };
  }
  if (session.profile.role !== "volunteer" || session.profile.status !== "active") {
    return { error: "Only active volunteer accounts can coordinate requests." };
  }
  return { userId: session.user.id };
}

/** Volunteer starts assisting an ACTIVE request. Upsert = concurrency-safe. */
export async function startAssisting(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const guard = await requireActiveVolunteer();
  if (guard.error) return { ok: false, error: guard.error };

  const requestId = String(formData.get("requestId") ?? "").trim();
  if (!isUuid(requestId)) {
    return { ok: false, error: "Invalid request reference." };
  }

  const supabase = await createSupabaseServerClient();

  // Verify via the volunteer function (role-checked in the database) that the
  // request is active. Never touch request.status — lifecycle stays untouched.
  const { data: visible, error: visibleError } = await supabase.rpc(
    "volunteer_request_detail",
    { p_request_id: requestId }
  );
  if (visibleError) {
    console.error("startAssisting lookup failed:", visibleError.message);
    return { ok: false, error: "Could not verify the request. Please try again." };
  }
  const request = (visible as { status?: string }[] | null)?.[0];
  if (!request || request.status !== "active") {
    return { ok: false, error: "This request is not active, so it cannot be assisted." };
  }

  const { error: dbError } = await supabase.from("request_assistance").upsert(
    {
      request_id: requestId,
      volunteer_id: guard.userId,
      status: "assisting",
    },
    { onConflict: "request_id,volunteer_id" }
  );

  if (dbError) {
    console.error("startAssisting failed:", dbError.message);
    return { ok: false, error: "Could not record your assistance. Please try again." };
  }

  revalidatePath("/volunteer");
  revalidatePath(`/volunteer/requests/${requestId}`);
  return { ok: true, error: null, success: "You are now assisting this request." };
}

/** Volunteer stops assisting. Only their own record can change (RLS too). */
export async function stopAssisting(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const guard = await requireActiveVolunteer();
  if (guard.error) return { ok: false, error: guard.error };

  const requestId = String(formData.get("requestId") ?? "").trim();
  if (!isUuid(requestId)) {
    return { ok: false, error: "Invalid request reference." };
  }

  const supabase = await createSupabaseServerClient();
  const { error: dbError } = await supabase
    .from("request_assistance")
    .update({ status: "stopped" })
    .eq("request_id", requestId)
    .eq("volunteer_id", guard.userId)
    .eq("status", "assisting");

  if (dbError) {
    console.error("stopAssisting failed:", dbError.message);
    return { ok: false, error: "Could not stop assisting. Please try again." };
  }

  revalidatePath("/volunteer");
  revalidatePath(`/volunteer/requests/${requestId}`);
  return { ok: true, error: null, success: "You have stopped assisting this request." };
}

/** Volunteer saves a short coordination note on their OWN assistance record. */
export async function saveAssistanceNote(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const guard = await requireActiveVolunteer();
  if (guard.error) return { ok: false, error: guard.error };

  const requestId = String(formData.get("requestId") ?? "").trim();
  if (!isUuid(requestId)) {
    return { ok: false, error: "Invalid request reference." };
  }

  const noteRaw = String(formData.get("note") ?? "").trim();
  const error = validateAssistanceNote(noteRaw);
  if (error) return { ok: false, error };

  const supabase = await createSupabaseServerClient();
  const { error: dbError } = await supabase
    .from("request_assistance")
    .update({ note: noteRaw === "" ? null : noteRaw })
    .eq("request_id", requestId)
    .eq("volunteer_id", guard.userId)
    .eq("status", "assisting");

  if (dbError) {
    console.error("saveAssistanceNote failed:", dbError.message);
    return { ok: false, error: "Could not save your note. Please try again." };
  }

  revalidatePath(`/volunteer/requests/${requestId}`);
  return { ok: true, error: null, success: "Note saved." };
}

