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
 *
 * A slot whose photograph is missing renders nothing, so visitors never see
 * an "image coming soon" box.
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
}

/**
 * All named image slots used across the public-facing pages.
 * Change a source here; nothing else needs editing.
 */
export const SITE_IMAGES: Record<string, ImageSlot> = {
  hero: {
    photo: "hero-emergency",
    alt: "Paramedics rush a patient on a stretcher into an emergency entrance, a blood bag hanging from the drip stand",
    mask: "blob",
    focalPosition: "45% 50%",
  },
  requestBlood: {
    photo: "blood-bag",
    alt: "A labelled blood bag hanging beside a hospital bed",
    mask: "arch",
    focalPosition: "29% 36%",
  },
  aboutSection: {
    photo: "hero-donor",
    alt: "A glowing red blood drop streaking between connected screens at dusk",
    mask: "elliptical",
    focalPosition: "50% 50%",
  },
  requesterDashboard: {
    photo: "hero-emergency",
    alt: "Paramedics rush a patient on a stretcher into an emergency entrance, a blood bag hanging from the drip stand",
    mask: "arch",
    focalPosition: "45% 50%",
  },
  donorDashboard: {
    photo: "hero-donor",
    alt: "A glowing red blood drop streaking between connected screens at dusk",
    mask: "asymRounded",
    focalPosition: "46% 62%",
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
  // Used for full-width banners, so it needs the wide crop at every size.
  elliptical: [
    { media: "(max-width: 639px)", aspect: "wide" },
    { media: "(min-width: 640px)", aspect: "wide" },
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