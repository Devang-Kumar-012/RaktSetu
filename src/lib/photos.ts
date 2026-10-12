/**
 * TYPED ACCESS TO THE GENERATED PHOTOGRAPHY.
 *
 * `public/images/raktsetu/manifest.json` is written by
 * `scripts/build-photo-assets.ts` (npm run build:assets) and is the single
 * record of what actually exists on disk. This module is the only place the
 * application reads it, so:
 *
 *  - the filenames, widths, focal crops and LQIPs are never retyped by hand;
 *  - a missing or misspelled photo id fails to COMPILE instead of rendering a
 *    broken <img> at runtime;
 *  - and re-running the pipeline updates the UI with no code change at all.
 *
 * Everything here is plain data with no browser APIs, so it can be imported from
 * a server component. The image components that use it are server components
 * too, which keeps these base64 LQIPs out of the client bundle entirely.
 */
import manifestJson from "../../public/images/raktsetu/manifest.json";

/** A single generated file at one width, for one aspect ratio. */
export interface PhotoSource {
  webp: string;
  jpeg: string;
  width: number;
  height: number;
  /** 20px-wide blurred preview, inlined as a data URL for the blur-up. */
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

const manifest = manifestJson as unknown as Record<string, PhotoManifestEntry>;

/** The ids the pipeline emits, derived from the manifest so they cannot drift. */
export type PhotoId = keyof typeof manifestJson;

/**
 * How each composition is ART-DIRECTED across viewports.
 *
 * This is the part `next/image`'s `sizes` cannot express. `sizes` only tells the
 * browser how many pixels wide to download; the browser still fills the box by
 * cropping ONE source frame. When the frame changes shape between a phone and a
 * desktop — a tall column becoming a circular hero — a single source would have
 * to be centre-cropped at runtime, and the donor's hand would drift out of frame
 * on exactly one of the two.
 *
 * So each composition names the crop to use at each breakpoint. `<picture>` +
 * `media` then picks the matching set, and only ONE set is ever downloaded.
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
 * circular/organic hero clip, so the 1:1 square is used: it is cut on the heart,
 * and a square puts the hand and the heart on one optical centre line instead of
 * letting them drift apart.
 */
export const HERO_DONOR_ART_DIRECTION: ArtDirection[] = [
  { media: "(max-width: 639px)", aspect: "portrait" },
  { media: "(min-width: 640px)", aspect: "square" },
];

/**
 * Request page side image — the blood bag in the ward.
 *
 * The bag hangs on the left of the frame, so the crop is focused left and up. The
 * 4:5 portrait keeps the bag, its B+ label, and enough of the bed and staff to
 * stay medical; a square is available where a 4:5 would push the label off.
 */
export const BLOOD_BAG_ART_DIRECTION: ArtDirection[] = [
  { media: "(max-width: 639px)", aspect: "portrait" },
  { media: "(min-width: 640px)", aspect: "portrait" },
];

/** Look up one photograph. Typo-proof: the id must exist in the manifest. */
export function getPhoto(id: PhotoId): PhotoManifestEntry {
  const entry = manifest[id as string];
  if (!entry) {
    throw new Error(
      `Unknown photo "${id}". Run \`npm run build:assets\` to regenerate the manifest.`
    );
  }
  return entry;
}

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
 * Every generated file is listed with an explicit `w` descriptor, so the browser
 * picks by the REAL pixel density of the screen and the layout's `sizes` hint —
 * not by guessing from a single file. Listing the whole ladder is what stops a
 * 3x phone downloading the 480px crop and looking soft, while a large desktop
 * never downloads more than the largest step.
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
 * Painted UNDERNEATH the real image on the same box, so the frame shows a blurred
 * version of the photograph immediately and never flashes empty background. The
 * real image sits on top and covers it once decoded.
 */
export function lqipBackground(variant: PhotoVariant): string {
  return `url("${largestSource(variant).lqip}")`;
}

