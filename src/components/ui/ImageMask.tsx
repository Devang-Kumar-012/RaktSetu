import { cn } from "@/lib/cn";

/**
 * ORGANIC IMAGE MASKING SYSTEM.
 *
 * Premium editorial image masks built with CSS border-radius, elliptical
 * percentage radii, overflow: hidden and pseudo-elements. No clip-path
 * polygons — every shape is genuinely smooth at every viewport size.
 *
 * Usage:
 *   <ImageMask mask="blob" className="w-80 h-80">
 *     <Image ... />
 *   </ImageMask>
 *
 * The mask is applied to a wrapper that clips its children. Children fill the
 * wrapper with object-fit: cover and object-position from the image slot config.
 */
export interface ImageMaskProps {
  /** Mask style name matching a CSS class in globals.css image-mask section. */
  mask: "blob" | "elliptical" | "asymRounded" | "circular" | "arch" | "wave" | "bgOrganic";
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  /** When true, renders as a background-image container instead of clipping children. */
  background?: boolean;
}

const MASK_CLASSES: Record<string, string> = {
  blob: "mask-blob",
  elliptical: "mask-elliptical",
  asymRounded: "mask-asym-rounded",
  circular: "mask-circular",
  arch: "mask-arch",
  wave: "mask-wave",
  bgOrganic: "mask-bg-organic",
};

export function ImageMask({
  mask,
  className,
  style,
  children,
  background = false,
}: ImageMaskProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden",
        background ? "mask-bg-organic" : MASK_CLASSES[mask],
        className
      )}
      style={style}
    >
      {children}
    </div>
  );
}