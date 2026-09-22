"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionInfo } from "@/lib/profile";
import type { ProfileActionState } from "@/lib/actions/action-state";
import {
  validateBloodGroup,
  validateBloodComponent,
  validateUnits,
  validateUrgency,
  validateHospitalName,
  validateLocality,
  validateRequiredBy,
  validateContactName,
  validatePhone,
  validateRequestNote,
} from "@/lib/validation";
import type { BloodComponent, RequestUrgency } from "@/types";
import { parseCoordInput, roundCoord } from "@/lib/geo";
import { geocodeHospitalArea } from "@/lib/geocode";

/**
 * Creates a blood request. Server-side auth + role enforcement: only an
 * authenticated, active requester can create one, and always as themselves.
 * Every field is re-validated here — client checks are convenience only.
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

  const error =
    validateBloodGroup(bloodGroup) ??
    validateBloodComponent(bloodComponent) ??
    validateUnits(units) ??
    validateUrgency(urgency) ??
    validateHospitalName(hospitalName) ??
    validateLocality(hospitalLocality) ??
    validateRequiredBy(requiredBy) ??
    validateContactName(contactName) ??
    validatePhone(contactPhone) ??
    validateRequestNote(note);
  if (error) return { ok: false, error };

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

  return { ok: true, error: null, success: "Request created." };
}

/**
 * Cancels the requester's own ACTIVE request. RLS + the lifecycle check
 * constraint enforce ownership and terminal-state rules in the database too.
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
  const { error: dbError } = await supabase
    .from("blood_requests")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("requester_id", session.user.id)
    .eq("status", "active");

  if (dbError) {
    console.error("cancelBloodRequest failed:", dbError.message);
    return { ok: false, error: "Could not cancel the request. Please try again." };
  }

  return { ok: true, error: null, success: "Request cancelled." };
}

/**
 * Marks the requester's own ACTIVE request as fulfilled.
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
  const { error: dbError } = await supabase
    .from("blood_requests")
    .update({ status: "fulfilled", fulfilled_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("requester_id", session.user.id)
    .eq("status", "active");

  if (dbError) {
    console.error("fulfillBloodRequest failed:", dbError.message);
    return { ok: false, error: "Could not update the request. Please try again." };
  }

  return { ok: true, error: null, success: "Marked as fulfilled." };
}
