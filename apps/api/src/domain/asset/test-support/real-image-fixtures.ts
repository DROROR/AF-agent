/**
 * REAL ENCODED IMAGE FILES, shared by every test that needs one.
 *
 * Produced by a real encoder (libvips via `sharp`, 2026-09-19) and inlined as
 * base64, so the suite proves this system agrees with a real PNG/JPEG/WebP
 * writer without taking an image dependency at runtime. Each fixture's
 * expected facts are that encoder's OWN reported metadata.
 */
export const REAL_IMAGE_FIXTURES = {
  /** 9x18, hasAlpha=true per sharp's own metadata. */
  pngRgba: "iVBORw0KGgoAAAANSUhEUgAAAAkAAAASCAYAAACJgPRIAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGUlEQVQokWPgEpFrIIQZRhUxjAYBA32DAABZDHb5KGwpGQAAAABJRU5ErkJggg==",
  /** 16x9, hasAlpha=false per sharp's own metadata. */
  pngOpaque: "iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWPgEpEjCTGMahAZDKEEAAoMIcGb1NWaAAAAAElFTkSuQmCC",
  /** 7x5, hasAlpha=true per sharp's own metadata. */
  pngPaletteAlpha: "iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAMAAAC+RAbqAAAAA1BMVEUKFB5+TFI6AAAAAXRSTlOArV5bRgAAAAlwSFlzAAAD6AAAA+gBtXtSawAAAAxJREFUCJljYCAOAAAAKAABYElfMgAAAABJRU5ErkJggg==",
  /** 8x8, hasAlpha=false per sharp's own metadata. */
  jpeg: "/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAgP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdgKA//9k=",
  /** 64x36, hasAlpha=false per sharp's own metadata. */
  webpLossyOpaque: "UklGRkIAAABXRUJQVlA4IDYAAABQAwCdASpAACQAPm02mEkkIyKhIqgAgA2JaQAAE/GT218PwAD++iGXzse4P+g+GifktAAAAAA=",
  /** 20x40, hasAlpha=true per sharp's own metadata. */
  webpLosslessAlpha: "UklGRh4AAABXRUJQVlA4TBEAAAAvE8AJEAdQiirUo0CBiOh/AAA=",
  /** 12x24, hasAlpha=true per sharp's own metadata. */
  webpLossyAlpha: "UklGRl4AAABXRUJQVlA4WAoAAAAQAAAACwAAFwAAQUxQSAoAAAABB1CgiAhERP8DVlA4IC4AAADQAgCdASoMABgAPm0skkWkIqGYBABABsSzgFp0FpIAAP76IY7J3pcRhcChIAAA"
} as const;

export type RealImageFixtureName = keyof typeof REAL_IMAGE_FIXTURES;

/** The bytes of one real encoded fixture. */
export function realImageBytes(name: RealImageFixtureName): Buffer {
  return Buffer.from(REAL_IMAGE_FIXTURES[name], "base64");
}
