"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionInfo } from "@/lib/profile";
import type { ProfileActionState } from "@/lib/actions/action-state";
import { bloodRequestFieldErrors } from "@/lib/validation";
import type { BloodComponent, RequestUrgency } from "@/types";
import { parseCoordInput, roundCoord } from "@/lib/geo";
import { geocodeHospitalArea } from "@/lib/geocode";

/** Plain-language message when a lifecycle update matched zero rows: the
 *  request was no longer in the expected state (someone or something else
 *  changed it first), or it was never the caller's to change. Never leaks
 *  which of the two happened. */
const RACE_MESSAGE =
  "This request changed just now — it may already be closed. Refresh the page to see its current state.";

/**
 * Creates a blood request. Server-side auth + role enforcement: only an
 * authenticated, active requester can create one, and always as themselves.
 * Every field is re-validated here — client checks are convenience only.
 * On success the requester lands on their dashboard, where the new active
 * request (and its alert progress) is shown immediately.
 */
export async function createBloodRequest(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const session = await getSessionInfo();
  if (!session.configured || !session.user || !session.profile) {
    return { ok: false, error: "Please log in as a requester to create a request." };
  }
  if (session.profile.role !== "requester" || session.profile.status !== "active") {
    return { ok: false, error: "Only active requester accounts can create blood requests." };
  }

  const bloodGroup = String(formData.get("bloodGroup") ?? "").trim();
  const bloodComponent = String(formData.get("bloodComponent") ?? "").trim();
  const units = String(formData.get("units") ?? "").trim();
  const hospitalName = String(formData.get("hospitalName") ?? "").trim();
  const hospitalLocality = String(formData.get("hospitalLocality") ?? "").trim();
  const urgency = String(formData.get("urgency") ?? "").trim();
  const requiredBy = String(formData.get("requiredBy") ?? "").trim();
  const contactName = String(formData.get("contactName") ?? "").trim();
  const contactPhone = String(formData.get("contactPhone") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  // Same validators, same order as the client pre-check (validation.ts).
  const fieldErrors = bloodRequestFieldErrors({
    bloodGroup,
    bloodComponent,
    units,
    hospitalName,
    hospitalLocality,
    urgency,
    requiredBy,
    contactName,
    contactPhone,
    note,
  });
  const firstError = Object.values(fieldErrors)[0];
  if (firstError) return { ok: false, error: firstError };

  // Approximate hospital location, for distance estimates only.
  // 1) If the requester picked a lookup candidate ("lat:lng"), use that.
  // 2) Otherwise try a best-effort geocode of "hospital, locality".
  // 3) If both fail, store no coordinates — matching still works, the
  //    request just can't be distance-sorted until it gets a location.
  const coordsRaw = String(formData.get("coordsChoice") ?? "").trim();
  let hospitalCoords: { lat: number; lng: number } | null = (() => {
    if (coordsRaw === "") return null;
    const [latRaw, lngRaw] = coordsRaw.split(":");
    const lat = parseCoordInput(latRaw, "lat");
    const lng = parseCoordInput(lngRaw, "lng");
    if (!lat.ok || !lng.ok || lat.value === null || lng.value === null) return null;
    return { lat: roundCoord(lat.value), lng: roundCoord(lng.value) };
  })();

  if (!hospitalCoords) {
    hospitalCoords = await geocodeHospitalArea(hospitalName, hospitalLocality);
  }

  const supabase = await createSupabaseServerClient();
  const { error: dbError } = await supabase.from("blood_requests").insert({
    requester_id: session.user.id,
    blood_group: bloodGroup,
    blood_component: bloodComponent as BloodComponent,
    units: Number(units),
    hospital_name: hospitalName,
    hospital_locality: hospitalLocality,
    urgency: urgency as RequestUrgency,
    required_by: new Date(requiredBy).toISOString(),
    contact_name: contactName,
    contact_phone: contactPhone,
    note: note === "" ? null : note,
    hospital_latitude: hospitalCoords?.lat ?? null,
    hospital_longitude: hospitalCoords?.lng ?? null,
  });

  if (dbError) {
    console.error("createBloodRequest failed:", dbError.message);
    return { ok: false, error: "Could not create the request. Please try again." };
  }

  revalidatePath("/dashboard/requester");
  redirect("/dashboard/requester");
}

/**
 * Cancels the requester's own ACTIVE request. RLS + the lifecycle check
 * constraint enforce ownership and terminal-state rules in the database too.
 * Cancellation stays possible after a donor accepts — the lifecycle only
 * requires the request to still be active. The returned row count makes
 * race conditions (already closed elsewhere) visible as a plain message.
 */
export async function cancelBloodRequest(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const session = await getSessionInfo();
  if (!session.configured || !session.user) {
    return { ok: false, error: "Please log in first." };
  }

  const requestId = String(formData.get("requestId") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    return { ok: false, error: "Invalid request reference." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error: dbError } = await supabase
    .from("blood_requests")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("requester_id", session.user.id)
    .eq("status", "active")
    .select("id");

  if (dbError) {
    console.error("cancelBloodRequest failed:", dbError.message);
    return { ok: false, error: "Could not cancel the request. Please try again." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: RACE_MESSAGE };
  }

  revalidatePath("/dashboard/requester");
  // The same request is also rendered on its own details page and on the
  // matching preview, and the closure produced notifications for the donor
  // side — keep every cached view of it honest.
  revalidatePath(`/requests/${requestId}`);
  revalidatePath(`/requests/${requestId}/matches`);
  revalidatePath("/notifications");
  return { ok: true, error: null, success: "Request cancelled." };
}

/**
 * Marks the requester's own ACTIVE request as fulfilled. Same race-safe
 * pattern as cancellation: zero affected rows means the state moved first.
 */
export async function fulfillBloodRequest(
  _prev: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const session = await getSessionInfo();
  if (!session.configured || !session.user) {
    return { ok: false, error: "Please log in first." };
  }

  const requestId = String(formData.get("requestId") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    return { ok: false, error: "Invalid request reference." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error: dbError } = await supabase
    .from("blood_requests")
    .update({ status: "fulfilled", fulfilled_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("requester_id", session.user.id)
    .eq("status", "active")
    .select("id");

  if (dbError) {
    console.error("fulfillBloodRequest failed:", dbError.message);
    return { ok: false, error: "Could not update the request. Please try again." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: RACE_MESSAGE };
  }

  revalidatePath("/dashboard/requester");
  revalidatePath(`/requests/${requestId}`);
  revalidatePath(`/requests/${requestId}/matches`);
  revalidatePath("/notifications");
  return { ok: true, error: null, success: "Marked as fulfilled." };
}

