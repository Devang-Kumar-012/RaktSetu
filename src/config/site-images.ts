/**
 * CENTRALIZED IMAGE SLOT CONFIGURATION.
 *
 * Edit the source here and every component that references a slot updates
 * automatically. Slots are referenced by name, never by raw URL, so images
 * can be swapped without hunting through components.
 *
 * Each slot defines:
 *  - photo: a PhotoId from @/lib/photos manifest (typo-proof at compile time)
 *  - alt: accessibility text describing the photograph
 *  - mask: one of the organic mask styles from ImageMask
 *  - focalPosition: object-position value for keeping the subject in frame
 *  - placeholder: label shown when the image is missing
 *
 * Missing images render an elegant placeholder that retains the mask shape,
 * dimensions and aspect ratio — no broken-image icons, no layout shift.
 */
import type { ArtDirection, PhotoId } from "@/lib/photos";

/** Every organic mask style the image system can draw. */
export type ImageMaskName =
  | "blob"
  | "elliptical"
  | "asymRounded"
  | "circular"
  | "arch"
  | "wave"
  | "bgOrganic";

export interface ImageSlot {
  photo?: PhotoId;
  alt: string;
  mask: ImageMaskName;
  focalPosition: string;
  placeholder: string;
}

/**
 * All named image slots used across the public-facing pages.
 * Change a source here; nothing else needs editing.
 */
export const SITE_IMAGES: Record<string, ImageSlot> = {
  hero: {
    photo: "hero-donor",
    alt: "A blood donor's arm connected to a donation line, their hand holding a red heart marked with a blood drop",
    mask: "blob",
    focalPosition: "46% 62%",
    placeholder: "Add hero image",
  },
  requestBlood: {
    photo: "blood-bag",
    alt: "A labelled blood bag hanging beside a hospital bed",
    mask: "arch",
    focalPosition: "29% 36%",
    placeholder: "Add request image",
  },
  donorStory: {
    photo: "hero-donor",
    alt: "A donor giving blood",
    mask: "circular",
    focalPosition: "50% 50%",
    placeholder: "Add donor image",
  },
  aboutSection: {
    photo: "hero-donor",
    alt: "A donor giving blood in a clinic setting",
    mask: "elliptical",
    focalPosition: "50% 50%",
    placeholder: "Add about image",
  },
  emergencySection: {
    photo: "blood-bag",
    alt: "Emergency blood supply in a hospital ward",
    mask: "wave",
    focalPosition: "30% 40%",
    placeholder: "Add emergency image",
  },
} as const;

export type ImageSlotName = keyof typeof SITE_IMAGES;

/**
 * Art direction per mask style — the generated crop each viewport uses.
 *
 * Shared by SlotImage (rendering) and scripts/check-image-assets.ts (asset
 * integrity), so the two can never drift apart about which aspect ratios a
 * mask requires.
 */
export const ART_DIRECTION_BY_MASK: Record<ImageMaskName, ArtDirection[]> = {
  blob: [
    { media: "(max-width: 639px)", aspect: "portrait" },
    { media: "(min-width: 640px)", aspect: "square" },
  ],
  elliptical: [
    { media: "(max-width: 639px)", aspect: "portrait" },
    { media: "(min-width: 640px)", aspect: "portrait" },
  ],
  asymRounded: [
    { media: "(max-width: 639px)", aspect: "portrait" },
    { media: "(min-width: 640px)", aspect: "portrait" },
  ],
  circular: [
    { media: "(max-width: 639px)", aspect: "square" },
    { media: "(min-width: 640px)", aspect: "square" },
  ],
  arch: [
    { media: "(max-width: 639px)", aspect: "portrait" },
    { media: "(min-width: 640px)", aspect: "portrait" },
  ],
  wave: [
    { media: "(max-width: 639px)", aspect: "portrait" },
    { media: "(min-width: 640px)", aspect: "portrait" },
  ],
  bgOrganic: [
    { media: "(max-width: 639px)", aspect: "portrait" },
    { media: "(min-width: 640px)", aspect: "portrait" },
  ],
};