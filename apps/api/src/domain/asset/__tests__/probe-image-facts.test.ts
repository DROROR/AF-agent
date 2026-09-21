import { describe, expect, it } from "vitest";
import { probeImageFacts } from "../probe-image-facts.js";
import { realImageBytes } from "../test-support/real-image-fixtures.js";

/**
 * The parser, against files a real encoder actually wrote (see
 * test-support/real-image-fixtures.ts). The set covers each structurally
 * different encoding: PNG with a true alpha channel, opaque PNG, PALETTE PNG
 * whose transparency lives in a tRNS chunk rather than the colour type, JPEG
 * (a format with no alpha at all), and all three WebP container shapes - plain
 * lossy VP8, lossless VP8L, and the extended VP8X container that carries the
 * alpha flag.
 */


const bytes = realImageBytes;

describe("probeImageFacts", () => {
  it("measures a PNG with a real alpha channel", () => {
    expect(probeImageFacts(bytes("pngRgba"), "image/png")).toEqual({ widthPx: 9, heightPx: 18, hasAlpha: true });
  });

  it("measures an opaque PNG and does not claim transparency", () => {
    expect(probeImageFacts(bytes("pngOpaque"), "image/png")).toEqual({ widthPx: 16, heightPx: 9, hasAlpha: false });
  });

  it("finds transparency declared in a palette PNG's tRNS chunk, not only in its colour type", () => {
    expect(probeImageFacts(bytes("pngPaletteAlpha"), "image/png")).toEqual({ widthPx: 7, heightPx: 5, hasAlpha: true });
  });

  it("measures a JPEG, which can never carry alpha", () => {
    expect(probeImageFacts(bytes("jpeg"), "image/jpeg")).toEqual({ widthPx: 8, heightPx: 8, hasAlpha: false });
  });

  it("measures plain lossy WebP (VP8)", () => {
    expect(probeImageFacts(bytes("webpLossyOpaque"), "image/webp")).toEqual({ widthPx: 64, heightPx: 36, hasAlpha: false });
  });

  it("measures lossless WebP (VP8L) including its alpha bit", () => {
    expect(probeImageFacts(bytes("webpLosslessAlpha"), "image/webp")).toEqual({ widthPx: 20, heightPx: 40, hasAlpha: true });
  });

  it("measures extended WebP (VP8X) including its alpha flag", () => {
    expect(probeImageFacts(bytes("webpLossyAlpha"), "image/webp")).toEqual({ widthPx: 12, heightPx: 24, hasAlpha: true });
  });

  it("reports nothing for a file whose bytes do not match the type it claims", () => {
    expect(probeImageFacts(bytes("jpeg"), "image/png")).toBeNull();
    expect(probeImageFacts(bytes("pngRgba"), "image/webp")).toBeNull();
  });

  it("reports nothing for a truncated file rather than half-reading it", () => {
    for (const cut of [0, 4, 16, 24]) {
      expect(probeImageFacts(bytes("pngRgba").subarray(0, cut), "image/png")).toBeNull();
      expect(probeImageFacts(bytes("webpLosslessAlpha").subarray(0, cut), "image/webp")).toBeNull();
    }
    expect(probeImageFacts(bytes("jpeg").subarray(0, 3), "image/jpeg")).toBeNull();
  });

  it("reports nothing for formats it cannot honestly measure, rather than guessing", () => {
    expect(probeImageFacts(bytes("pngRgba"), "video/mp4")).toBeNull();
    expect(probeImageFacts(bytes("pngRgba"), "video/quicktime")).toBeNull();
    expect(probeImageFacts(bytes("pngRgba"), "application/pdf")).toBeNull();
    expect(probeImageFacts(Buffer.alloc(0), "image/png")).toBeNull();
  });

  it("accepts the MIME type in any case, since HTTP headers are not case-normalized for it", () => {
    expect(probeImageFacts(bytes("pngOpaque"), "IMAGE/PNG")).toEqual({ widthPx: 16, heightPx: 9, hasAlpha: false });
  });
});
