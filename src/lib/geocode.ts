/**
 * Server-side geocoding via OpenStreetMap Nominatim (no API key needed).
 *
 * Privacy rules:
 *   * Only general locality/hospital-area strings are ever sent for lookup —
 *     never street addresses, never user identity.
 *   * Returned coordinates are rounded to ~1 km before leaving this module.
 *   * Lookups are best-effort: any failure returns an empty result and the
 *     caller stores "no coordinates" — matching still works by locality text.
 *
 * Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 * light, low-volume use with a descriptive User-Agent. At this project's
 * scale that is fine; if traffic grows, self-host or switch to a licensed
 * provider and update this one file.
 */

import { isValidLatLng, roundCoord, type LatLng } from "@/lib/geo";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "RaktSetu/0.1 (student blood-donor coordination project)";
const TIMEOUT_MS = 5000;
const MAX_RESULTS = 3;
const MAX_QUERY_LENGTH = 150;

export interface GeocodeCandidate extends LatLng {
  label: string;
}

function normalizeQuery(raw: string): string {
  const q = raw.replace(/[\n\r]+/g, " ").replace(/\s+/g, " ").trim();
  return q.slice(0, MAX_QUERY_LENGTH);
}

async function nominatimSearch(query: string): Promise<GeocodeCandidate[]> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(MAX_RESULTS));
  url.searchParams.set("addressdetails", "0");
  // RaktSetu is currently India-focused; widen or remove when that changes.
  url.searchParams.set("countrycodes", "in");

  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "en",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) return [];

  const data: unknown = await response.json();
  if (!Array.isArray(data)) return [];

  const candidates: GeocodeCandidate[] = [];
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as { display_name?: unknown; lat?: unknown; lon?: unknown };
    if (typeof row.lat !== "string" || typeof row.lon !== "string") continue;
    const lat = roundCoord(Number(row.lat));
    const lng = roundCoord(Number(row.lon));
    if (!isValidLatLng({ lat, lng })) continue;
    const label =
      typeof row.display_name === "string" && row.display_name.trim().length > 0
        ? row.display_name.trim().slice(0, 120)
        : "Unknown area";
    candidates.push({ lat, lng, label });
  }
  return candidates;
}

/**
 * Looks up a donor locality ("Indiranagar, Bengaluru") and returns up to
 * three approximate area candidates for the donor to pick from.
 */
export async function lookupLocalities(query: string): Promise<GeocodeCandidate[]> {
  const q = normalizeQuery(query);
  if (q.length < 3) return [];
  try {
    return await nominatimSearch(q);
  } catch {
    return [];
  }
}

/**
 * Best-effort geocode for a hospital area. Returns the first match's
 * rounded coordinates, or null when nothing usable is found.
 */
export async function geocodeHospitalArea(
  hospitalName: string,
  locality: string
): Promise<LatLng | null> {
  const q = normalizeQuery([hospitalName, locality].filter(Boolean).join(", "));
  if (q.length < 3) return null;
  try {
    const [first] = await nominatimSearch(q);
    return first ? { lat: first.lat, lng: first.lng } : null;
  } catch {
    return null;
  }
}
