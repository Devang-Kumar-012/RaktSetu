import { existsSync } from "node:fs";
import { join } from "node:path";

import { ImageMask } from "@/components/ui/ImageMask";
import { ImagePlaceholder } from "@/components/ui/ImagePlaceholder";
import { EditorialImage } from "@/components/ui/EditorialImage";
import { findPhoto } from "@/lib/photos";
import {
  ART_DIRECTION_BY_MASK,
  SITE_IMAGES,
  type ImageSlotName,
} from "@/config/site-images";

/**
 * SLOT-BACKED IMAGE.
 *
 * Looks up an image slot from SITE_IMAGES and renders:
 *   - EditorialImage inside an ImageMask when the photograph exists in the
 *     manifest (typo-proof at compile time via PhotoId) AND every art-directed
 *     crop file is present on disk;
 *   - ImagePlaceholder otherwise — same mask, same dimensions, no layout shift,
 *     no broken-image icon, and never a URL that would 404.
 *
 * The on-disk check is deliberately all-or-nothing: `<picture>` emits a
 * `srcset` covering the whole width ladder of every art-directed aspect, so a
 * PARTIAL generation would still ship missing files as broken requests. If any
 * required file is absent the slot falls back whole; `npm run check:images`
 * reports exactly which files are missing.
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

export function SlotImage({
  slot,
  sizes,
  className,
  priority = false,
  objectPosition,
}: SlotImageProps) {
  const config = SITE_IMAGES[slot];
  const photoId = config.photo;
  const entry = photoId ? findPhoto(photoId) : null;
  const artDirection = ART_DIRECTION_BY_MASK[config.mask];

  // True only when every crop the mask needs — at every width, in both
  // formats — actually exists under public/. Verified here at render time on
  // the server, so the browser never receives a URL that would 404.
  const publicDir = join(process.cwd(), "public");
  const hasEveryCropFile =
    entry !== null &&
    artDirection.every(({ aspect }) => {
      const variant = entry.variants.find((v) => v.aspect === aspect);
      if (!variant || variant.sources.length === 0) return false;
      return variant.sources.every(
        (source) =>
          existsSync(join(publicDir, source.webp.slice(1))) &&
          existsSync(join(publicDir, source.jpeg.slice(1)))
      );
    });

  if (!photoId || !entry || !hasEveryCropFile) {
    return (
      <ImagePlaceholder
        slot={slot}
        mask={config.mask}
        className={className}
        label={config.placeholder}
      />
    );
  }

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
