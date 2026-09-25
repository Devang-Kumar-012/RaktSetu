"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionInfo } from "@/lib/profile";
import { lookupLocalities, type GeocodeCandidate } from "@/lib/geocode";
import type { ProfileActionState } from "@/lib/actions/action-state";
import type { LocationLookupState } from "@/lib/actions/location-state";

/*
 * `LocationLookupState` and `initialLocationLookupState` deliberately do NOT
 * live here. A "use server" module may only export async functions: any other
 * export is replaced in the client bundle by a server-reference proxy, so a
 * Client Component importing that object received a proxy rather than the
 * value and `/request-blood` crashed into the global error boundary. They now
 * live in @/lib/actions/location-state.
 */

/**
 * Looks up approximate area candidates. The query comes from an explicit
 * "locationQuery" field when present; otherwise the action reuses whatever
 * locality text is already in the form (donor "locality", or the request's
 * "hospitalName" + "hospitalLocality").
 */
export async function lookupAreaCandidates(
  _prev: LocationLookupState,
  formData: FormData
): Promise<LocationLookupState> {
  const session = await getSessionInfo();
  if (!session.configured || !session.user) {
    return { ok: false, error: "Please log in first.", candidates: [] };
  }

  const explicit = String(formData.get("locationQuery") ?? "").trim();
  const query =
    explicit ||
    String(formData.get("locality") ?? "").trim() ||
    [
      String(formData.get("hospitalName") ?? "").trim(),
      String(formData.get("hospitalLocality") ?? "").trim(),
    ]
      .filter(Boolean)
      .join(", ");

  if (query.length < 3) {
    return {
      ok: false,
      error: "Type a bit more — area and city, e.g. \"Indiranagar, Bengaluru\".",
      candidates: [],
    };
  }

  const candidates = await lookupLocalities(query);
  if (candidates.length === 0) {
    return {
      ok: false,
      error: "Couldn't find that area right now. You can still save without map coordinates — matching works by locality text.",
      candidates: [],
    };
  }

  return { ok: true, error: null, candidates };
}

/**
 * Removes the donor's stored coordinates (keeps the locality text).
 * Own-row only; RLS enforces the same on the database side.
 */
export async function clearDonorLocation(
  _prev: ProfileActionState,
  _formData: FormData
): Promise<ProfileActionState> {
  const session = await getSessionInfo();
  if (!session.configured || !session.user || session.profile?.role !== "donor") {
    return { ok: false, error: "Only logged-in donors can do this." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("donor_profiles")
    .update({ latitude: null, longitude: null })
    .eq("user_id", session.user.id);

  if (error) {
    console.error("clearDonorLocation failed:", error.message);
    return { ok: false, error: "Could not remove your location. Please try again." };
  }

  revalidatePath("/profile/donor");
  revalidatePath("/dashboard/donor");
  return { ok: true, error: null, success: "Stored location removed." };
}
