/**
 * Central geographic utilities — the ONE place for distance math.
 *
 * The SQL side has a mirror of haversineKm in
 * supabase/migrations/0005_matching_function.sql (public.haversine_km).
 * Keep the two in sync. Coordinates are always APPROXIMATE (rounded to
 * 2 decimals ≈ 1 km) and are used only for distance estimates — never
 * shown as a donor's position, never an exact address.
 */

export const COORD_PRECISION = 2;

/** A coordinate pair strong enough for distance estimates, or nothing. */
export interface LatLng {
  lat: number;
  lng: number;
}

export function isValidLatitude(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function isValidLongitude(lng: number): boolean {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

/** Both coordinates must be present, finite, and in range — or neither. */
export function isValidLatLng(value: LatLng | null | undefined): value is LatLng {
  if (!value) return false;
  return isValidLatitude(value.lat) && isValidLongitude(value.lng);
}

/**
 * Great-circle distance between two points, in kilometres.
 * Returns null when any input is missing or invalid — callers should treat
 * that as "distance unknown" rather than guessing.
 */
export function haversineKm(
  lat1: number | null | undefined,
  lng1: number | null | undefined,
  lat2: number | null | undefined,
  lng2: number | null | undefined
): number | null {
  if (
    lat1 === null || lat1 === undefined ||
    lng1 === null || lng1 === undefined ||
    lat2 === null || lat2 === undefined ||
    lng2 === null || lng2 === undefined ||
    !isValidLatitude(lat1) ||
    !isValidLongitude(lng1) ||
    !isValidLatitude(lat2) ||
    !isValidLongitude(lng2)
  ) {
    return null;
  }

  const R = 6371; // Earth's mean radius, km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Rounds a coordinate to storage precision (~1 km grid). */
export function roundCoord(value: number): number {
  const factor = 10 ** COORD_PRECISION;
  return Math.round(value * factor) / factor;
}

/**
 * Parses one coordinate from form input. Blank → { ok, value: null } (no
 * location given). Non-numeric or out-of-range → { ok: false }.
 * `kind` selects the allowed range for the value.
 */
export function parseCoordInput(
  raw: string | null | undefined,
  kind: "lat" | "lng"
): { ok: true; value: number | null } | { ok: false } {
  const text = String(raw ?? "").trim();
  if (text === "") return { ok: true, value: null };
  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false };
  const inRange = kind === "lat" ? isValidLatitude(n) : isValidLongitude(n);
  if (!inRange) return { ok: false };
  return { ok: true, value: n };
}

/** Human phrasing for an approximate distance. */
export function formatDistance(km: number | null | undefined): string {
  if (km === null || km === undefined || !Number.isFinite(km)) return "distance unknown";
  if (km < 1) return "under 1 km";
  return `about ${Math.round(km)} km`;
}
