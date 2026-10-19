/**
 * TYPED ACCESS TO THE GENERATED PHOTOGRAPHY.
 *
 * `public/images/raktsetu/manifest.json` is written by
 * `scripts/build-photo-assets.ts` (npm run build:assets) and is the single
 * record of what actually exists on disk. This module is the only place the
 * application reads it, so:
 *
 *  - the filenames, widths, focal crops and LQIPs are never retyped by hand;
 *  - a misspelled photo id fails to COMPILE instead of rendering a broken
 *    <img> at runtime;
 *  - and re-running the pipeline updates the UI with no code change at all.
 *
 * LEGITIMATE EMPTY STATE
 *
 * Until the supplied photographs have been placed in
 * `assets/raktsetu-source/` and `npm run build:assets` has been run, the
 * manifest is an empty object. That is expected, not broken: every configured
 * slot falls back to its masked placeholder, and no URL that would 404 ever
 * reaches the browser. `npm run check:images` reports where the pipeline
 * stands.
 *
 * Everything here is plain data with no browser APIs, so it can be imported
 * from a server component. The image components that use it are server
 * components too, which keeps the base64 LQIPs out of the client bundle.
 */
import manifestJson from "../../public/images/raktsetu/manifest.json";

/** A single generated file at one width, for one aspect ratio. */
export interface PhotoSource {
  webp: string;
  jpeg: string;
  width: number;
  height: number;
  /** Blurred preview, inlined as a data URL for the blur-up. */
  lqip: string;
}

/** One aspect ratio, with every width emitted for it. */
export interface PhotoVariant {
  /** `square` | `portrait` | `wide` — the art direction this crop was cut for. */
  aspect: string;
  ratio: number;
  intrinsic: { width: number; height: number };
  sources: PhotoSource[];
}

export interface PhotoManifestEntry {
  alt: string;
  source: { width: number; height: number; original: string };
  poster: { webp: string; jpeg: string; width: number; height: number };
  variants: PhotoVariant[];
}

/**
 * THE PHOTOGRAPHY CONTRACT.
 *
 * These are the ids `npm run build:assets` emits. They are declared here —
 * rather than derived from whatever the manifest happens to contain — so the
 * compile-time typo-proofing survives an empty manifest, while the manifest
 * stays the RUNTIME truth: a configured id with no manifest entry renders the
 * slot's placeholder, never a broken image. Add an id here when the pipeline
 * learns to emit a new photograph.
 */
export const PHOTO_IDS = ["hero-donor", "hero-emergency", "blood-bag"] as const;
export type PhotoId = (typeof PHOTO_IDS)[number];

/* --------------------------- runtime validation --------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function parseSource(value: unknown): PhotoSource | null {
  if (!isRecord(value)) return null;
  const { webp, jpeg, width, height, lqip } = value;
  if (typeof webp !== "string" || !webp.startsWith("/images/")) return null;
  if (typeof jpeg !== "string" || !jpeg.startsWith("/images/")) return null;
  if (!isPositiveNumber(width) || !isPositiveNumber(height)) return null;
  if (typeof lqip !== "string" || !lqip.startsWith("data:image/")) return null;
  return { webp, jpeg, width, height, lqip };
}

function parseVariant(value: unknown): PhotoVariant | null {
  if (!isRecord(value)) return null;
  const { aspect, ratio, intrinsic, sources } = value;
  if (typeof aspect !== "string" || aspect === "") return null;
  if (!isPositiveNumber(ratio)) return null;
  if (!isRecord(intrinsic)) return null;
  if (!isPositiveNumber(intrinsic.width) || !isPositiveNumber(intrinsic.height)) return null;
  if (!Array.isArray(sources) || sources.length === 0) return null;
  const parsedSources: PhotoSource[] = [];
  for (const source of sources) {
    const parsed = parseSource(source);
    if (!parsed) return null;
    parsedSources.push(parsed);
  }
  return {
    aspect,
    ratio,
    intrinsic: { width: intrinsic.width, height: intrinsic.height },
    sources: parsedSources,
  };
}

function parseEntry(value: unknown): PhotoManifestEntry | null {
  if (!isRecord(value)) return null;
  const { alt, source, poster, variants } = value;
  if (typeof alt !== "string" || alt === "") return null;
  if (!isRecord(source)) return null;
  if (!isPositiveNumber(source.width) || !isPositiveNumber(source.height)) return null;
  if (typeof source.original !== "string") return null;
  if (!isRecord(poster)) return null;
  if (typeof poster.webp !== "string" || typeof poster.jpeg !== "string") return null;
  if (!isPositiveNumber(poster.width) || !isPositiveNumber(poster.height)) return null;
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const parsedVariants: PhotoVariant[] = [];
  for (const variant of variants) {
    const parsed = parseVariant(variant);
    if (!parsed) return null;
    parsedVariants.push(parsed);
  }
  return {
    alt,
    source: { width: source.width, height: source.height, original: source.original },
    poster: { webp: poster.webp, jpeg: poster.jpeg, width: poster.width, height: poster.height },
    variants: parsedVariants,
  };
}

/**
 * Validate a parsed manifest against the schema above. Unreadable entries are
 * skipped rather than crashing the site — the slot falls back to its
 * placeholder, and `npm run check:images` reports exactly what failed.
 */
export function parsePhotoManifest(value: unknown): Record<string, PhotoManifestEntry> {
  if (!isRecord(value)) return {};
  const manifest: Record<string, PhotoManifestEntry> = {};
  for (const id of PHOTO_IDS) {
    const entry = parseEntry(value[id]);
    if (entry) manifest[id] = entry;
  }
  return manifest;
}

const manifest: Record<string, PhotoManifestEntry> = parsePhotoManifest(manifestJson);

/** Look up one photograph; null while the pipeline has not generated it. */
export function findPhoto(id: PhotoId): PhotoManifestEntry | null {
  return manifest[id] ?? null;
}

/**
 * Look up one photograph. Throws when it has not been generated — for call
 * sites (like EditorialImage) that cannot render without a real entry.
 */
export function getPhoto(id: PhotoId): PhotoManifestEntry {
  const entry = findPhoto(id);
  if (!entry) {
    throw new Error(
      `Photo "${id}" has not been generated. Add the originals to ` +
      `assets/raktsetu-source/ and run \`npm run build:assets\`.`
    );
  }
  return entry;
}

/** The ids the pipeline has generated so far (empty before the first run). */
export function generatedPhotoIds(): PhotoId[] {
  return PHOTO_IDS.filter((id) => manifest[id] !== undefined);
}

/**
 * How each composition is ART-DIRECTED across viewports.
 *
 * This is the part `next/image`'s `sizes` cannot express. `sizes` only tells
 * the browser how many pixels wide to download; the browser still fills the
 * box by cropping ONE source frame. When the frame changes shape between a
 * phone and a desktop, a single source would have to be centre-cropped at
 * runtime and the subject would drift out of frame on one of the two.
 *
 * So each composition names the crop to use at each breakpoint. `<picture>` +
 * `media` then picks the matching set, and only ONE set is downloaded.
 */
export interface ArtDirection {
  /** Media query that selects this crop. */
  media: string;
  /** Must be an aspect present in the manifest for that photo. */
  aspect: string;
}

export const HERO_DONOR = "hero-donor" as const;
export const BLOOD_BAG = "blood-bag" as const;

/**
 * Homepage hero — the donor holding the heart.
 *
 * Phones and small tablets get the 4:5 portrait, tall enough to hold the whole
 * arm and keep the hand off the bottom edge. From `sm` up the frame becomes the
 * circular/organic hero clip, so the 1:1 square is used: it is cut on the
 * heart, and a square puts the hand and the heart on one optical centre line
 * instead of letting them drift apart.
 */
export const HERO_DONOR_ART_DIRECTION: ArtDirection[] = [
  { media: "(max-width: 639px)", aspect: "portrait" },
  { media: "(min-width: 640px)", aspect: "square" },
];

/**
 * Request page side image — the blood bag in the ward.
 *
 * The bag hangs on the left of the frame, so the crop is focused left and up.
 * The 4:5 portrait keeps the bag, its B+ label, and enough of the bed and staff
 * to stay medical.
 */
export const BLOOD_BAG_ART_DIRECTION: ArtDirection[] = [
  { media: "(max-width: 639px)", aspect: "portrait" },
  { media: "(min-width: 640px)", aspect: "portrait" },
];

/** One aspect's crop set for a photograph. */
export function getVariant(id: PhotoId, aspect: string): PhotoVariant {
  const variant = getPhoto(id).variants.find((v) => v.aspect === aspect);
  if (!variant) {
    const available = getPhoto(id).variants.map((v) => v.aspect).join(", ");
    throw new Error(
      `Photo "${id}" has no "${aspect}" crop. Available: ${available}. ` +
      `Re-run \`npm run build:assets\`.`
    );
  }
  return variant;
}

/**
 * A `srcset` string over every width emitted for an aspect.
 *
 * Every generated file is listed with an explicit `w` descriptor, so the
 * browser picks by the REAL pixel density of the screen and the layout's
 * `sizes` hint — not by guessing from a single file.
 */
export function buildSrcSet(variant: PhotoVariant, format: "webp" | "jpeg"): string {
  return variant.sources
    .map((s) => `${format === "webp" ? s.webp : s.jpeg} ${s.width}w`)
    .join(", ");
}

/** The largest step — used for the `src` fallback and the `width`/`height` box. */
export function largestSource(variant: PhotoVariant): PhotoSource {
  return variant.sources[variant.sources.length - 1];
}

/**
 * The LQIP for a crop, as a CSS `background-image`.
 *
 * Painted UNDERNEATH the real image on the same box, so the frame shows a
 * blurred version of the photograph immediately and never flashes empty
 * background. The real image sits on top and covers it once decoded.
 */
export function lqipBackground(variant: PhotoVariant): string {
  return `url("${largestSource(variant).lqip}")`;
}

