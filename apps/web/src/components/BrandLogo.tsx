import Image from "next/image";
import type { ReactElement } from "react";

/**
 * The one seam that matters for branding: every place in the app that
 * shows the brand mark goes through here, so swapping the supplied asset
 * in means replacing these two files - public/brand/dyo-logo.png (full
 * logo) and public/brand/dyo-mark.png (compact mark) - never touching a
 * component that renders them.
 *
 * As of this review, both files present at these paths are the SAME image
 * (1254x1254, square) - see the visual review report for what was found
 * and why dyo-mark.png is not yet a distinct cropped icon (this component
 * deliberately does not crop/derive one itself - see CLAUDE.md's "do not
 * redesign, generate, recolor, crop, or modify" the logo).
 */
const BRAND_LOGO_FULL_SRC = "/brand/dyo-logo.png";
const BRAND_LOGO_MARK_SRC = "/brand/dyo-mark.png";

export interface BrandLogoProps {
  /** "full" = logo (expanded sidebar, auth pages). "mark" = compact icon (collapsed sidebar). */
  variant: "full" | "mark";
  height?: number;
  priority?: boolean;
  className?: string;
}

/** Both current source files are square (1254x1254) - update this if the final supplied asset has a different aspect ratio. */
const ASPECT_RATIO: Record<BrandLogoProps["variant"], number> = {
  full: 1,
  mark: 1
};

export function BrandLogo({ variant, height = 28, priority = false, className }: BrandLogoProps): ReactElement {
  const width = Math.round(height * ASPECT_RATIO[variant]);

  return (
    <Image
      src={variant === "full" ? BRAND_LOGO_FULL_SRC : BRAND_LOGO_MARK_SRC}
      alt="DYO"
      width={width}
      height={height}
      priority={priority}
      {...(className ? { className } : {})}
    />
  );
}
