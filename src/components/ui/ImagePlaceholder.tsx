import { cn } from "@/lib/cn";
import { ImageMask } from "@/components/ui/ImageMask";
import type { ImageMaskName } from "@/config/site-images";

/**
 * BRANDED FALLBACK IMAGE PANEL.
 *
 * Rendered when a configured image slot has no generated photograph yet (the
 * asset pipeline has not been run, or a generated file is missing). It fills
 * the ENTIRE masked frame — same silhouette, same dimensions, same aspect
 * ratio — so the layout never shifts and the slot reads as an intentional part
 * of the design rather than a blank hole or a broken-image icon.
 *
 * The blood-drop watermark is decorative (aria-hidden SVG, no <img>), so it
 * adds no misleading alt text.
 */
export interface ImagePlaceholderProps {
  slot: string;
  mask: ImageMaskName;
  className?: string;
  label?: string;
}

const DEFAULT_LABELS: Record<string, string> = {
  hero: "Add hero image",
  requestBlood: "Add request image",
  donorStory: "Add donor image",
  aboutSection: "Add about image",
  emergencySection: "Add emergency image",
};

export function ImagePlaceholder({
  slot,
  mask,
  className,
  label,
}: ImagePlaceholderProps) {
  return (
    <ImageMask mask={mask} className={className}>
      <div
        className={cn(
          // Absolute + inset-0 is what makes the panel FILL the masked frame;
          // without it the content collapsed to a small box inside an empty mask.
          "absolute inset-0 flex flex-col items-center justify-center gap-1.5 overflow-hidden p-4 text-center",
          "bg-gradient-to-br from-blood-50 via-blood-100/80 to-blood-200/60",
          // Container queries keep the same panel tidy in small placements like
          // the overlapping circular detail (80–96px) as in the large frames.
          // Thresholds use the CONTENT box (the query basis under container-type:
          // inline-size), so 304px/320px cleanly separate the circles (~48–64px
          // content) from the large frames (352px+ content).
          "@container @max-[19rem]:p-1.5 @max-[19rem]:gap-1"
        )}
      >
        <svg
          className="h-7 w-7 text-blood-400 sm:h-9 sm:w-9 @max-[19rem]:h-5 @max-[19rem]:w-5"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12 2.5c.43 0 .82.25 1.02.63 1.05 2 4.73 5.7 4.73 9.37a5.75 5.75 0 0 1-11.5 0c0-3.67 3.68-7.37 4.73-9.37.2-.38.59-.63 1.02-.63Z" />
        </svg>
        <p className="text-xs font-semibold leading-tight text-blood-800 sm:text-sm @max-[19rem]:text-[10px]">
          {label ?? DEFAULT_LABELS[slot] ?? "Add image"}
        </p>
        <p className="hidden text-[10px] leading-tight text-blood-700/80 @min-[20rem]:block sm:text-xs">
          Photograph coming soon
        </p>
      </div>
    </ImageMask>
  );
}
