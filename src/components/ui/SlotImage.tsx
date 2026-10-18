import { ImageMask } from "@/components/ui/ImageMask";
import { ImagePlaceholder } from "@/components/ui/ImagePlaceholder";
import { EditorialImage } from "@/components/ui/EditorialImage";
import { getPhoto } from "@/lib/photos";
import { SITE_IMAGES, type ImageSlotName } from "@/config/site-images";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * SLOT-BACKED IMAGE.
 *
 * Looks up an image slot from SITE_IMAGES and renders:
 *   - EditorialImage inside an ImageMask when the photograph exists in the
 *     manifest (typo-proof at compile time via PhotoId);
 *   - ImagePlaceholder otherwise — same mask, same dimensions, no layout shift,
 *     no broken-image icon.
 *
 * This is the single component every page should use for configured images.
 * To change an image, edit src/config/site-images.ts — nothing else.
 */
export interface SlotImageProps {
  slot: ImageSlotName;
  /** CSS `sizes` hint for responsive image selection. */
  sizes: string;
  className?: string;
  /** Eagerly load above-the-fold images. */
  priority?: boolean;
  /** Override the default object-position for this placement. */
  objectPosition?: string;
}

/** Art direction per mask style — the aspect the crop should use at each viewport. */
const ART_DIRECTION_BY_MASK: Record<string, { media: string; aspect: string }[]> = {
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

export function SlotImage({
  slot,
  sizes,
  className,
  priority = false,
  objectPosition,
}: SlotImageProps) {
  const config = SITE_IMAGES[slot];

  // If the slot has no photo configured, or the manifest doesn't contain it,
  // render the placeholder instead of crashing.
  let photoEntry;
  try {
    if (config.photo) {
      photoEntry = getPhoto(config.photo);
    }
  } catch {
    photoEntry = undefined;
  }

  if (!photoEntry) {
    return (
      <ImagePlaceholder
        slot={slot}
        mask={config.mask}
        className={className}
        label={config.placeholder}
      />
    );
  }

  // Fall back to the placeholder when no actual image file exists on disk.
  // This guards against a manifest entry whose source files were never
  // generated (e.g. build:assets has not been run) or were removed.
  const publicDir = join(process.cwd(), "public");
  let hasAssets = false;
  for (const variant of photoEntry.variants) {
    for (const source of variant.sources) {
      if (
        existsSync(join(publicDir, source.webp.slice(1))) ||
        existsSync(join(publicDir, source.jpeg.slice(1)))
      ) {
        hasAssets = true;
        break;
      }
    }
    if (hasAssets) break;
  }

  if (!hasAssets) {
    return (
      <ImagePlaceholder
        slot={slot}
        mask={config.mask}
        className={className}
        label={config.placeholder}
      />
    );
  }

  const artDirection = ART_DIRECTION_BY_MASK[config.mask];
  const photoId = config.photo!;
  const position = objectPosition ?? config.focalPosition;

  return (
    <ImageMask mask={config.mask} className={className}>
      <EditorialImage
        photo={photoId}
        alt={config.alt}
        artDirection={artDirection}
        sizes={sizes}
        objectPosition={position}
        priority={priority}
      />
    </ImageMask>
  );
}