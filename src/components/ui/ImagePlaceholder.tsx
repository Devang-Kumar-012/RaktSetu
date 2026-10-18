import { cn } from "@/lib/cn";
import { ImageMask } from "@/components/ui/ImageMask";

/**
 * ELEGANT EDITABLE IMAGE PLACEHOLDER.
 *
 * Rendered when a configured image slot has no source image. It retains the
 * intended organic mask, correct dimensions and aspect ratio so the surrounding
 * layout never shifts. No broken-image icons, ever.
 *
 * Props:
 *  - slot: name of the image slot (used for the label)
 *  - mask: mask style to retain the silhouette
 *  - className: additional classes for sizing/layout
 *  - label: override the default "Add X image" label
 */
export interface ImagePlaceholderProps {
  slot: string;
  mask: "blob" | "elliptical" | "asymRounded" | "circular" | "arch" | "wave" | "bgOrganic";
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
          "mask-frame flex flex-col items-center justify-center gap-2 text-ink-400",
          "border-2 border-dashed border-ink-200 bg-ink-50/50"
        )}
      >
        <svg
          className="h-8 w-8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L3 15" />
        </svg>
        <p className={cn("text-sm font-medium text-ink-600")}>
          {label ?? DEFAULT_LABELS[slot] ?? "Add image"}
        </p>
      </div>
    </ImageMask>
  );
}