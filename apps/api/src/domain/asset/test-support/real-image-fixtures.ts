/**
 * REAL ENCODED IMAGE FILES, shared by every test that needs one.
 *
 * Produced by a real encoder (libvips/libwebp via `sharp`, 2026-09-21) except
 * where a note says otherwise, and inlined as base64 so the suite needs no
 * image dependency at runtime. Each fixture's doc comment records that
 * encoder's OWN reported facts - crucially, `hasAlpha` (does the file carry an
 * alpha channel) and `isOpaque` (are its pixels actually opaque) SEPARATELY,
 * because that is exactly the distinction these tests exist to prove.
 */
export const REAL_IMAGE_FIXTURES = {
  /**
   * 12x8 RGBA PNG, every pixel fully opaque - the "screenshot exported with an alpha channel" case.
   * Encoder-reported: 12x8, alpha channel true, opaque pixels true.
   */
  pngOpaqueRgba: "iVBORw0KGgoAAAANSUhEUgAAAAwAAAAICAYAAADN5B7xAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFklEQVQYlWPgEpH7TwpmGNUgQoNQAgDrj3YhM/ZstQAAAABJRU5ErkJggg==",
  /**
   * 20x20 PNG, an 8x8 opaque square on a transparent background - a genuine logo.
   * Encoder-reported: 20x20, alpha channel true, opaque pixels false.
   */
  pngTransparentLogo: "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAIklEQVQ4jWNgGAUjGJyQk/uPD48aSBiMhuF/ipPNKBhGAABpDYDB/bRzqgAAAABJRU5ErkJggg==",
  /**
   * 40x40 PNG whose only content is an 8x4 block at (16,18) - mostly transparent padding.
   * Encoder-reported: 40x40, alpha channel true, opaque pixels false.
   */
  pngLargeTransparentPadding: "iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAALUlEQVRYhe3QwQkAQAgDQeu0YrvSDvwKdzOw/5AIAADgUlavnUsDX38QAAB+NvcgRCFLZtOLAAAAAElFTkSuQmCC",
  /**
   * 6x6 greyscale PNG with no transparency at all.
   * Encoder-reported: 6x6, alpha channel false, opaque pixels true.
   */
  pngGreyAlphaOpaque: "iVBORw0KGgoAAAANSUhEUgAAAAYAAAAGCAMAAADXEh96AAAAA1BMVEV4eHhEoA7CAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgIBYAAAAqAAE3/Fn1AAAAAElFTkSuQmCC",
  /**
   * 9x7 JPEG - a format with no alpha channel in any of its forms.
   * Encoder-reported: 9x7, alpha channel false, opaque pixels true.
   */
  jpegOpaque: "/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAHAAkDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAgP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdgKA//9k=",
  /**
   * 14x10 lossless WebP whose alpha_is_used bit is set although every pixel is opaque (libwebp drops a useless alpha channel, so this bit was set on a real libwebp bitstream; sharp still decodes it, reporting hasAlpha=true and isOpaque=true).
   * Encoder-reported: 14x10, alpha channel true, opaque pixels true.
   */
  webpOpaqueWithAlphaCapability: "UklGRh4AAABXRUJQVlA4TBEAAAAvDUACEAdQiirUo/+BiOh/AAA=",
  /**
   * 64x36 plain lossy WebP - the format cannot carry alpha.
   * Encoder-reported: 64x36, alpha channel false, opaque pixels true.
   */
  webpLossyOpaque: "UklGRkIAAABXRUJQVlA4IDYAAABQAwCdASpAACQAPm02mEkkIyKhIqgAgA2JaQAAE/GT218PwAD++iGXzse4P+g+GifktAAAAAA=",
  /**
   * 5x5 RGBA PNG, opaque.
   * Encoder-reported: 5x5, alpha channel true, opaque pixels true.
   */
  png16BitOpaque: "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQI12PgEpH7j44ZaCAIACtgHsQmA4/yAAAAAElFTkSuQmCC",
  /**
   * 6x4 palette PNG declaring a fully-transparent palette entry that NO pixel uses (sharp: hasAlpha=true, isOpaque=true).
   * Encoder-reported: 6x4, alpha channel true, opaque pixels true.
   */
  pngPaletteUnusedTransparency: "iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAMAAACa2r5xAAAACVBMVEX/AAAA/wAAAP8tSs2KAAAAA3RSTlP//wDXyg1BAAAADklEQVR4nGNgYARDbBQAAL4ADZno5Y0AAAAASUVORK5CYII=",
  /**
   * 6x4 palette PNG where the first 6 pixels DO use the transparent palette entry (sharp: isOpaque=false).
   * Encoder-reported: 6x4, alpha channel true, opaque pixels false.
   */
  pngPaletteUsedTransparency: "iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAMAAACa2r5xAAAACVBMVEX/AAAA/wAAAP8tSs2KAAAAA3RSTlP//wDXyg1BAAAADklEQVR4nGNgAgMGbAAAAUIADdXDPdwAAAAASUVORK5CYII="
} as const;

export type RealImageFixtureName = keyof typeof REAL_IMAGE_FIXTURES;

/** The bytes of one real encoded fixture. */
export function realImageBytes(name: RealImageFixtureName): Buffer {
  return Buffer.from(REAL_IMAGE_FIXTURES[name], "base64");
}
