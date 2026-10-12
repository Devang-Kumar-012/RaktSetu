import { cn } from "@/lib/cn";
import {
  buildSrcSet,
  getPhoto,
  getVariant,
  largestSource,
  lqipBackground,
  type ArtDirection,
  type PhotoId,
} from "@/lib/photos";

export interface EditorialImageProps {
  /** Which photograph from the manifest. Typo-proof. */
  photo: PhotoId;
  /** Override the alt text. Defaults to the manifest's description. */
  alt?: string;
  /**
   * Art direction. The FIRST entry whose `media` matches is used; the last entry
   * is the fallback for anything the earlier queries did not claim. Order matters.
   */
  artDirection: ArtDirection[];
  /**
   * The `sizes` hint. Must describe how wide the box actually is at each
   * breakpoint — this is what the browser combines with the `srcset` widths to
   * choose a file, so a wrong value means a wrong-sized download.
   */
  sizes: string;
  className?: string;
  /** How the photograph fills its box. `cover` is correct for every crop here. */
  objectFit?: "cover" | "contain";
  /**
   * Which part of the crop stays visible when the box aspect does not match the
   * file's. `object-position` is what keeps the subject in frame.
   */
  objectPosition?: string;
  /**
   * Eagerly load and fetch at high priority. Use ONLY for the one image that is
   * above the fold on a page — everything else stays lazy.
   */
  priority?: boolean;
  /** `eager` for priority images, `lazy` otherwise. Set by `priority`. */
  loading?: "eager" | "lazy";
  /** Rounded/organic clipping. Applied to the frame, never to the file. */
  clipClassName?: string;
}

/**
 * AN ART-DIRECTED, RESPONSIVE PHOTOGRAPH.
 *
 * WHY THIS IS A `<picture>` AND NOT A PLAIN `next/image`
 *
 * The supplied photographs are 1536x1024 and the compositions change SHAPE
 * between viewports: the hero is a tall column on a phone and a circular clip on
 * a desktop, and the request page's side image is a tall panel at every size.
 * `next/image`'s `sizes` only tells the browser how many pixels wide to fetch —
 * the browser still fills the box by cropping that ONE frame. A single frame
 * cannot be a good 4:5 column AND a good 1:1 circle at the same time; one of
 * them always centre-crops the subject toward an edge.
 *
 * So the crops are made properly, ahead of time, in `build:assets`, and this
 * component hands the browser the set that matches the viewport:
 *
 *   - one `<source>` per art-directed aspect, each with a `media` query and a
 *     `srcset` over every generated width, so exactly ONE set is downloaded and
 *     the right width within it;
 *   - a WebP `<source>` ahead of the JPEG one, so WebP is used when supported
 *     and the JPEG ladder is the fallback for engines that are not;
 *   - an `<img>` carrying the largest step as `src` plus real `width`/`height`,
 *     which reserves the box before the bytes land — the single biggest cause of
 *     layout shift on an image-led page;
 *   - `object-fit` / `object-position` on the img, so the photograph fills the
 *     box without ever being stretched;
 *   - and the crop's LQIP painted on the frame as a background, underneath, so
 *     the box shows a blurred version of the photo immediately and never flashes
 *     an empty rectangle.
 *
 * `next/image` IS still the right tool where a single crop serves every
 * viewport; this is the case where it is not, and the crops exist precisely so
 * that the browser never has to improvise one.
 */
export function EditorialImage({
  photo,
  alt,
  artDirection,
  sizes,
  className,
  objectFit = "cover",
  objectPosition,
  priority = false,
  loading,
  clipClassName,
}: EditorialImageProps) {
  const entry = getPhoto(photo);

  // Resolve every requested aspect up front so a typo fails during render with a
  // clear message, rather than producing an empty <source> and a blank box.
  const resolved = artDirection.map((direction) => {
    const variant = getVariant(photo, direction.aspect);
    return {
      media: direction.media,
      variant,
      webpSrcSet: buildSrcSet(variant, "webp"),
      jpegSrcSet: buildSrcSet(variant, "jpeg"),
    };
  });

  // The fallback is whichever crop claims the widest range — in practice the last
  // entry, which is why the art-direction lists end with a `min-width` query.
  const fallback = resolved[resolved.length - 1];
  const largest = largestSource(fallback.variant);

  return (
    <span
      className={cn(
        "relative block overflow-hidden bg-blood-50",
        clipClassName,
        className
      )}
      // The LQIP sits on the frame itself, so it is clipped by the same organic
      // shape as the photograph and never peeks out around the edge.
      style={{ backgroundImage: lqipBackground(fallback.variant), backgroundSize: "cover" }}
    >
      <picture>
        {resolved.map(({ media, webpSrcSet }) => (
          <source key={`${media}-webp`} type="image/webp" media={media} srcSet={webpSrcSet} />
        ))}
        {resolved.map(({ media, jpegSrcSet }) => (
          <source
            key={`${media}-jpeg`}
            type="image/jpeg"
            media={media}
            srcSet={jpegSrcSet}
          />
        ))}
        <img
          src={largest.jpeg}
          srcSet={buildSrcSet(fallback.variant, "jpeg")}
          sizes={sizes}
          alt={alt ?? entry.alt}
          width={largest.width}
          height={largest.height}
          loading={loading ?? (priority ? "eager" : "lazy")}
          decoding={priority ? "sync" : "async"}
          // `fetchPriority` is the current spelling; `fetchpriority` keeps older
          // React typings happy, and React passes both through to the DOM.
          fetchPriority={priority ? "high" : undefined}
          data-nimg={priority ? "priority" : "lazy"}
          className="absolute inset-0 h-full w-full"
          style={{ objectFit, objectPosition }}
        />
      </picture>
    </span>
  );
}
