import { describe, expect, it } from "vitest";
import { probeImageFacts } from "../probe-image-facts.js";
import { realImageBytes } from "../test-support/real-image-fixtures.js";

/**
 * The parser and pixel decoder, against files a real encoder actually wrote.
 *
 * The point of every case here is the same distinction: "this file CAN carry
 * transparency" is not "this picture IS transparent". An opaque screenshot
 * saved as RGBA, and a palette PNG declaring a transparent colour it never
 * uses, must both behave as opaque; a real logo must still be detected; and a
 * file whose pixels cannot be decoded here must say UNKNOWN rather than pick a
 * side.
 */

const bytes = realImageBytes;

describe("probeImageFacts - transparency is measured from pixels, not from the container", () => {
  it("reads a fully opaque RGBA PNG as opaque, although it carries an alpha channel", () => {
    const facts = probeImageFacts(bytes("pngOpaqueRgba"), "image/png");
    expect(facts).toMatchObject({
      widthPx: 12,
      heightPx: 8,
      hasAlphaChannel: true,
      pixelAnalysis: "DECODED",
      hasTransparentPixels: false,
      transparentPixelRatio: 0,
      visibleCoverageRatio: 1
    });
    expect(facts?.visibleContentBounds).toEqual({ xPx: 0, yPx: 0, widthPx: 12, heightPx: 8 });
  });

  it("detects a genuinely transparent logo, and where its content actually is", () => {
    const facts = probeImageFacts(bytes("pngTransparentLogo"), "image/png");
    expect(facts?.hasAlphaChannel).toBe(true);
    expect(facts?.pixelAnalysis).toBe("DECODED");
    expect(facts?.hasTransparentPixels).toBe(true);
    // An 8x8 square inside a 20x20 canvas: 64 of 400 pixels are visible.
    expect(facts?.transparentPixelRatio).toBeCloseTo(1 - 64 / 400, 6);
    expect(facts?.visibleCoverageRatio).toBeCloseTo(64 / 400, 6);
    expect(facts?.visibleContentBounds).toEqual({ xPx: 6, yPx: 6, widthPx: 8, heightPx: 8 });
  });

  it("reports where the content is when most of the file is transparent padding", () => {
    const facts = probeImageFacts(bytes("pngLargeTransparentPadding"), "image/png");
    expect(facts?.hasTransparentPixels).toBe(true);
    expect(facts?.visibleContentBounds).toEqual({ xPx: 16, yPx: 18, widthPx: 8, heightPx: 4 });
    expect(facts?.visibleCoverageRatio).toBeCloseTo(32 / 1600, 6);
  });

  it("does not call a palette PNG transparent when nothing uses its transparent entry", () => {
    const facts = probeImageFacts(bytes("pngPaletteUnusedTransparency"), "image/png");
    // The file DOES declare transparency - that capability is reported...
    expect(facts?.hasAlphaChannel).toBe(true);
    // ...and the pixels say it is entirely opaque, which is what decides.
    expect(facts?.pixelAnalysis).toBe("DECODED");
    expect(facts?.hasTransparentPixels).toBe(false);
    expect(facts?.transparentPixelRatio).toBe(0);
    expect(facts?.visibleCoverageRatio).toBe(1);
  });

  it("does detect a palette PNG whose pixels really use the transparent entry", () => {
    const facts = probeImageFacts(bytes("pngPaletteUsedTransparency"), "image/png");
    expect(facts?.hasTransparentPixels).toBe(true);
    expect(facts?.transparentPixelRatio).toBeCloseTo(6 / 24, 6);
    expect(facts?.visibleContentBounds).toEqual({ xPx: 0, yPx: 1, widthPx: 6, heightPx: 3 });
  });

  it("reads a greyscale PNG with no transparency at all as opaque", () => {
    const facts = probeImageFacts(bytes("pngGreyAlphaOpaque"), "image/png");
    expect(facts).toMatchObject({ widthPx: 6, heightPx: 6, hasAlphaChannel: false, hasTransparentPixels: false });
  });

  it("reads a 16-bit RGBA PNG", () => {
    expect(probeImageFacts(bytes("png16BitOpaque"), "image/png")).toMatchObject({ widthPx: 5, heightPx: 5, hasTransparentPixels: false });
  });

  it("treats a JPEG as opaque by the format's own definition, with nothing to decode", () => {
    expect(probeImageFacts(bytes("jpegOpaque"), "image/jpeg")).toEqual({
      widthPx: 9,
      heightPx: 7,
      hasAlphaChannel: false,
      pixelAnalysis: "NO_ALPHA_CHANNEL",
      hasTransparentPixels: false,
      transparentPixelRatio: 0,
      visibleContentBounds: { xPx: 0, yPx: 0, widthPx: 9, heightPx: 7 },
      visibleCoverageRatio: 1
    });
  });

  it("treats a lossy WebP as opaque, because that format cannot carry alpha", () => {
    expect(probeImageFacts(bytes("webpLossyOpaque"), "image/webp")).toMatchObject({
      widthPx: 64,
      heightPx: 36,
      hasAlphaChannel: false,
      pixelAnalysis: "NO_ALPHA_CHANNEL",
      hasTransparentPixels: false
    });
  });

  it("reports UNKNOWN for a WebP that declares alpha - the flag is not evidence, and its pixels cannot be decoded here", () => {
    const facts = probeImageFacts(bytes("webpOpaqueWithAlphaCapability"), "image/webp");
    expect(facts).toMatchObject({
      widthPx: 14,
      heightPx: 10,
      hasAlphaChannel: true,
      pixelAnalysis: "NOT_DECODED",
      hasTransparentPixels: null,
      transparentPixelRatio: null,
      visibleCoverageRatio: null
    });
    expect(facts?.visibleContentBounds).toBeNull();
  });
});

describe("probeImageFacts - refusals", () => {
  it("reports nothing for a file whose bytes do not match the type it claims", () => {
    expect(probeImageFacts(bytes("jpegOpaque"), "image/png")).toBeNull();
    expect(probeImageFacts(bytes("pngOpaqueRgba"), "image/webp")).toBeNull();
  });

  it("reports nothing for a truncated file rather than half-reading it", () => {
    for (const cut of [0, 4, 16, 24]) {
      expect(probeImageFacts(bytes("pngOpaqueRgba").subarray(0, cut), "image/png")).toBeNull();
      expect(probeImageFacts(bytes("webpOpaqueWithAlphaCapability").subarray(0, cut), "image/webp")).toBeNull();
    }
    expect(probeImageFacts(bytes("jpegOpaque").subarray(0, 3), "image/jpeg")).toBeNull();
  });

  it("keeps the dimensions but reports transparency as UNKNOWN when a PNG's pixel data is unusable", () => {
    const damaged = Buffer.from(bytes("pngTransparentLogo"));
    // Corrupt the compressed image data, leaving the header intact - the file
    // still says what size it is, but nothing can be measured from its pixels.
    const idatStart = damaged.indexOf(Buffer.from("IDAT", "ascii")) + 4;
    damaged.fill(0x7f, idatStart, idatStart + 12);
    const facts = probeImageFacts(damaged, "image/png");
    expect(facts).toMatchObject({ widthPx: 20, heightPx: 20, hasAlphaChannel: true, pixelAnalysis: "NOT_DECODED", hasTransparentPixels: null });
  });

  it("reports nothing for formats it cannot honestly measure, rather than guessing", () => {
    expect(probeImageFacts(bytes("pngOpaqueRgba"), "video/mp4")).toBeNull();
    expect(probeImageFacts(bytes("pngOpaqueRgba"), "video/quicktime")).toBeNull();
    expect(probeImageFacts(bytes("pngOpaqueRgba"), "application/pdf")).toBeNull();
    expect(probeImageFacts(Buffer.from("not an image at all"), "image/png")).toBeNull();
    expect(probeImageFacts(Buffer.alloc(0), "image/png")).toBeNull();
  });

  it("accepts the MIME type in any case, since HTTP headers are not case-normalized for it", () => {
    expect(probeImageFacts(bytes("pngOpaqueRgba"), "IMAGE/PNG")).toMatchObject({ widthPx: 12, heightPx: 8 });
  });
});
