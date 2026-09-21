import { inflateSync } from "node:zlib";

/**
 * REAL MEASURED IMAGE FACTS, FROM THE FILE'S OWN BYTES.
 *
 * The slot gate judges whether an asset belongs in a slot, and whether it will
 * fit, from dimensions, aspect ratio, transparency and visible content. None of
 * those may come from a filename, a client-supplied field, or a guess.
 *
 * TRANSPARENCY IS A FACT ABOUT PIXELS, NOT ABOUT CONTAINERS (2026-09-21
 * correction). "This file can carry an alpha channel" and "this picture has
 * transparent pixels" are different claims, and only the second one matters to
 * a device screen. A screenshot exported as RGBA is fully opaque; a palette PNG
 * can declare a transparent colour it never uses. Both were previously read as
 * transparent, which would have blocked correct mappings and taught reviewers
 * to click through the warning.
 *
 * So the facts are kept apart:
 *   - `hasAlphaChannel` - what the container can carry. Evidence, never a
 *     verdict.
 *   - `hasTransparentPixels` / `transparentPixelRatio` - what the picture
 *     actually contains, from decoded pixels. NULL when the pixels could not be
 *     decoded, which the gate treats as "unknown, ask a human" - never as
 *     opaque, and never as transparent.
 *   - `visibleContentBounds` / `visibleCoverageRatio` - where the picture's
 *     non-transparent content actually is, so a logo with wide transparent
 *     padding is not mistaken for an image that fills its slot.
 *
 * What gets decoded: PNG (every non-interlaced colour type and bit depth,
 * including palette transparency). JPEG has no alpha channel in any of its
 * forms, so its opacity is a fact of the format rather than a decode. WebP's
 * alpha flag is readable but its pixels need a VP8/VP8L decoder this host does
 * not have, so a WebP that CAN carry alpha is reported as unknown rather than
 * assumed either way.
 *
 * Nothing here executes anything: it reads fixed header positions, with every
 * read bounds-checked, and inflates PNG image data with Node's own zlib.
 */

/** How this module arrived at its transparency facts - the difference between a measurement, a property of the format, and an honest "could not tell". */
export const PIXEL_ANALYSES = [
  /** Pixels were decoded and counted. */
  "DECODED",
  /** The format cannot encode transparency at all (JPEG; lossy WebP with no alpha flag), so opacity is certain without decoding. */
  "NO_ALPHA_CHANNEL",
  /** The file may carry transparency but its pixels could not be decoded here - transparency is UNKNOWN, never assumed. */
  "NOT_DECODED"
] as const;
export type PixelAnalysis = (typeof PIXEL_ANALYSES)[number];

export interface VisibleContentBounds {
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
}

export interface ImageFacts {
  widthPx: number;
  heightPx: number;
  /**
   * Whether the encoding CAN carry per-pixel transparency. A fact about the
   * container and its flags - never evidence that any pixel is transparent.
   */
  hasAlphaChannel: boolean;
  pixelAnalysis: PixelAnalysis;
  /** Whether any pixel is actually less than fully opaque. Null when `pixelAnalysis` is NOT_DECODED. */
  hasTransparentPixels: boolean | null;
  /** The fraction of pixels that are not fully opaque, 0..1. Null when not decoded. */
  transparentPixelRatio: number | null;
  /** The bounding box of visibly-present content (alpha at or above VISIBLE_ALPHA). Null when not decoded, or when nothing is visible at all. */
  visibleContentBounds: VisibleContentBounds | null;
  /** The fraction of the image that is visibly present, 0..1. Null when not decoded. */
  visibleCoverageRatio: number | null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Chunk-walk bound: a hostile or malformed file must not be walked forever. */
const MAX_PNG_CHUNKS_SCANNED = 512;
/** Same bound for JPEG's own marker walk. */
const MAX_JPEG_MARKERS_SCANNED = 256;
/**
 * Above this, a full decode is refused and the transparency facts are reported
 * as unknown rather than spending the memory. A decoded RGBA buffer is 4 bytes
 * per pixel, so this bounds one decode at ~160 MB of pixels.
 */
export const MAX_DECODED_PIXELS = 40_000_000;
/** Alpha at or above this counts as visible content for the bounding box - below it the pixel contributes nothing a viewer can see. */
export const VISIBLE_ALPHA = 8;

/* ------------------------------------------------------------------ *
 * PNG.
 * ------------------------------------------------------------------ */

interface PngChunk {
  type: string;
  data: Buffer;
}

/** Walks the chunk list, bounded, stopping at IEND. Returns null for a structurally broken file. */
function readPngChunks(buffer: Buffer): PngChunk[] | null {
  const chunks: PngChunk[] = [];
  let offset = 8;
  for (let index = 0; index < MAX_PNG_CHUNKS_SCANNED; index += 1) {
    if (offset + 8 > buffer.length) {
      return chunks;
    }
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) {
      return chunks.length > 0 ? chunks : null;
    }
    chunks.push({ type, data: buffer.subarray(start, end) });
    if (type === "IEND") {
      return chunks;
    }
    offset = end + 4;
  }
  return chunks;
}

/** Bytes per complete pixel for a colour type, at 8 or 16 bits per sample. */
function pngSamplesPerPixel(colorType: number): number | null {
  switch (colorType) {
    case 0:
      return 1; // greyscale
    case 2:
      return 3; // truecolour
    case 3:
      return 1; // palette index
    case 4:
      return 2; // greyscale + alpha
    case 6:
      return 4; // truecolour + alpha
    default:
      return null;
  }
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

/** Reverses PNG's per-scanline filters in place, producing raw scanlines without their filter bytes. */
function unfilterScanlines(raw: Buffer, widthPx: number, heightPx: number, bytesPerPixel: number, bytesPerLine: number): Buffer | null {
  const out = Buffer.alloc(heightPx * bytesPerLine);
  let inputOffset = 0;
  for (let y = 0; y < heightPx; y += 1) {
    if (inputOffset + 1 + bytesPerLine > raw.length) {
      return null;
    }
    const filter = raw.readUInt8(inputOffset);
    inputOffset += 1;
    const lineStart = y * bytesPerLine;
    const previousStart = (y - 1) * bytesPerLine;
    for (let x = 0; x < bytesPerLine; x += 1) {
      const value = raw.readUInt8(inputOffset + x);
      const left = x >= bytesPerPixel ? out.readUInt8(lineStart + x - bytesPerPixel) : 0;
      const up = y > 0 ? out.readUInt8(previousStart + x) : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? out.readUInt8(previousStart + x - bytesPerPixel) : 0;
      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + Math.floor((left + up) / 2);
          break;
        case 4:
          restored = value + paethPredictor(left, up, upLeft);
          break;
        default:
          return null;
      }
      out.writeUInt8(restored & 0xff, lineStart + x);
    }
    inputOffset += bytesPerLine;
  }
  return out;
}

/** Reads one sample of `bitDepth` bits at sample index `i` within a scanline. Returned on the sample's own scale. */
function readSample(line: Buffer, lineStart: number, sampleIndex: number, bitDepth: number): number {
  if (bitDepth === 8) {
    return line.readUInt8(lineStart + sampleIndex);
  }
  if (bitDepth === 16) {
    // The high byte is all the precision any of these decisions needs.
    return line.readUInt8(lineStart + sampleIndex * 2);
  }
  const samplesPerByte = 8 / bitDepth;
  const byte = line.readUInt8(lineStart + Math.floor(sampleIndex / samplesPerByte));
  const withinByte = sampleIndex % samplesPerByte;
  const shift = 8 - bitDepth * (withinByte + 1);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

interface AlphaSummary {
  hasTransparentPixels: boolean;
  transparentPixelRatio: number;
  visibleContentBounds: VisibleContentBounds | null;
  visibleCoverageRatio: number;
}

/** Turns a per-pixel alpha reader into the transparency and coverage facts. */
function summarizeAlpha(widthPx: number, heightPx: number, alphaAt: (x: number, y: number) => number): AlphaSummary {
  let notFullyOpaque = 0;
  let visible = 0;
  let minX = widthPx;
  let minY = heightPx;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < widthPx; x += 1) {
      const alpha = alphaAt(x, y);
      if (alpha < 255) {
        notFullyOpaque += 1;
      }
      if (alpha >= VISIBLE_ALPHA) {
        visible += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const total = widthPx * heightPx;
  return {
    hasTransparentPixels: notFullyOpaque > 0,
    transparentPixelRatio: total === 0 ? 0 : notFullyOpaque / total,
    visibleContentBounds: maxX < 0 ? null : { xPx: minX, yPx: minY, widthPx: maxX - minX + 1, heightPx: maxY - minY + 1 },
    visibleCoverageRatio: total === 0 ? 0 : visible / total
  };
}

function probePng(buffer: Buffer): ImageFacts | null {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString("ascii", 12, 16) !== "IHDR") {
    return null;
  }
  const widthPx = buffer.readUInt32BE(16);
  const heightPx = buffer.readUInt32BE(20);
  const bitDepth = buffer.readUInt8(24);
  const colorType = buffer.readUInt8(25);
  const interlaced = buffer.readUInt8(28) !== 0;
  if (widthPx === 0 || heightPx === 0) {
    return null;
  }

  const samples = pngSamplesPerPixel(colorType);
  const chunks = samples === null ? null : readPngChunks(buffer);
  const transparency = chunks?.find((chunk) => chunk.type === "tRNS")?.data ?? null;
  // The container's own capability: a real alpha channel, or a tRNS chunk that
  // declares transparency for some colours. Both are CAPABILITY - whether any
  // pixel uses them is decided below, by looking.
  const hasAlphaChannel = colorType === 4 || colorType === 6 || transparency !== null;
  const undecoded = (): ImageFacts => ({
    widthPx,
    heightPx,
    hasAlphaChannel,
    pixelAnalysis: hasAlphaChannel ? "NOT_DECODED" : "NO_ALPHA_CHANNEL",
    hasTransparentPixels: hasAlphaChannel ? null : false,
    transparentPixelRatio: hasAlphaChannel ? null : 0,
    visibleContentBounds: hasAlphaChannel ? null : { xPx: 0, yPx: 0, widthPx, heightPx },
    visibleCoverageRatio: hasAlphaChannel ? null : 1
  });

  if (samples === null || chunks === null || interlaced || ![1, 2, 4, 8, 16].includes(bitDepth)) {
    // Adam7-interlaced data is laid out in seven passes this decoder does not
    // reassemble; an unknown colour type or bit depth is not guessed at.
    return undecoded();
  }
  if (widthPx * heightPx > MAX_DECODED_PIXELS) {
    return undecoded();
  }

  const imageData = chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data);
  if (imageData.length === 0) {
    return undecoded();
  }
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(imageData));
  } catch {
    return undecoded();
  }

  const bitsPerPixel = samples * bitDepth;
  const bytesPerLine = Math.ceil((widthPx * bitsPerPixel) / 8);
  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const lines = unfilterScanlines(raw, widthPx, heightPx, bytesPerPixel, bytesPerLine);
  if (lines === null) {
    return undecoded();
  }

  // The scale a sample is on, so a 16-bit or sub-byte sample compares correctly
  // against a tRNS value expressed at the same depth.
  const maxSample = bitDepth === 16 ? 255 : (1 << bitDepth) - 1;
  const alphaAt = (x: number, y: number): number => {
    const lineStart = y * bytesPerLine;
    if (colorType === 6) {
      return readSample(lines, lineStart, x * 4 + 3, bitDepth);
    }
    if (colorType === 4) {
      return readSample(lines, lineStart, x * 2 + 1, bitDepth);
    }
    if (colorType === 3) {
      const index = readSample(lines, lineStart, x, bitDepth);
      // A palette entry with no tRNS entry is fully opaque, and a tRNS chunk
      // shorter than the palette leaves the rest opaque - so an unused
      // transparent palette entry changes nothing about these pixels.
      return transparency !== null && index < transparency.length ? transparency.readUInt8(index) : 255;
    }
    if (colorType === 0) {
      if (transparency === null || transparency.length < 2) {
        return 255;
      }
      const grey = readSample(lines, lineStart, x, bitDepth);
      const transparentGrey = bitDepth === 16 ? transparency.readUInt8(0) : transparency.readUInt16BE(0);
      return grey === transparentGrey ? 0 : 255;
    }
    // colorType 2: truecolour, transparent only for one exact RGB triple.
    if (transparency === null || transparency.length < 6) {
      return 255;
    }
    const r = readSample(lines, lineStart, x * 3, bitDepth);
    const g = readSample(lines, lineStart, x * 3 + 1, bitDepth);
    const b = readSample(lines, lineStart, x * 3 + 2, bitDepth);
    const tr = bitDepth === 16 ? transparency.readUInt8(0) : transparency.readUInt16BE(0);
    const tg = bitDepth === 16 ? transparency.readUInt8(2) : transparency.readUInt16BE(2);
    const tb = bitDepth === 16 ? transparency.readUInt8(4) : transparency.readUInt16BE(4);
    return r === tr && g === tg && b === tb ? 0 : 255;
  };

  // Sub-byte and 16-bit samples are read on their own scale; alpha is compared
  // against that scale's own maximum rather than against 255.
  const scaled = maxSample === 255 ? alphaAt : (x: number, y: number) => Math.round((alphaAt(x, y) / maxSample) * 255);
  const summary = summarizeAlpha(widthPx, heightPx, colorType === 3 || colorType === 0 || colorType === 2 ? alphaAt : scaled);

  return {
    widthPx,
    heightPx,
    hasAlphaChannel,
    pixelAnalysis: "DECODED",
    hasTransparentPixels: summary.hasTransparentPixels,
    transparentPixelRatio: summary.transparentPixelRatio,
    visibleContentBounds: summary.visibleContentBounds,
    visibleCoverageRatio: summary.visibleCoverageRatio
  };
}

/* ------------------------------------------------------------------ *
 * JPEG.
 * ------------------------------------------------------------------ */

/** Start-of-Frame markers that carry the image's real size. C4/C8/CC are Huffman/DNL/arithmetic tables, not frames. */
function isJpegStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function probeJpeg(buffer: Buffer): ImageFacts | null {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8) {
    return null;
  }
  let offset = 2;
  for (let marker = 0; marker < MAX_JPEG_MARKERS_SCANNED; marker += 1) {
    // Markers may be preceded by any number of 0xFF fill bytes.
    while (offset < buffer.length && buffer.readUInt8(offset) === 0xff) {
      offset += 1;
    }
    if (offset + 3 > buffer.length) {
      return null;
    }
    const code = buffer.readUInt8(offset);
    const segmentLength = buffer.readUInt16BE(offset + 1);
    if (segmentLength < 2) {
      return null;
    }
    if (isJpegStartOfFrame(code)) {
      if (offset + 8 > buffer.length) {
        return null;
      }
      const heightPx = buffer.readUInt16BE(offset + 4);
      const widthPx = buffer.readUInt16BE(offset + 6);
      if (widthPx === 0 || heightPx === 0) {
        return null;
      }
      // JPEG has no alpha channel in any of its baseline/progressive forms, so
      // every pixel is opaque as a fact of the format - nothing to decode.
      return {
        widthPx,
        heightPx,
        hasAlphaChannel: false,
        pixelAnalysis: "NO_ALPHA_CHANNEL",
        hasTransparentPixels: false,
        transparentPixelRatio: 0,
        visibleContentBounds: { xPx: 0, yPx: 0, widthPx, heightPx },
        visibleCoverageRatio: 1
      };
    }
    if (code === 0xda) {
      return null; // Entropy-coded data begins; no frame header was found.
    }
    offset += 1 + segmentLength;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * WebP.
 * ------------------------------------------------------------------ */

function webpFacts(widthPx: number, heightPx: number, hasAlphaChannel: boolean): ImageFacts {
  // A WebP that cannot carry alpha is opaque by the format's own definition. One
  // that CAN needs a VP8/VP8L decoder to know whether it actually is - and this
  // host has none, so transparency is reported as unknown rather than guessed
  // from the flag. The gate turns that into "a human must confirm", never into
  // "assume transparent".
  return {
    widthPx,
    heightPx,
    hasAlphaChannel,
    pixelAnalysis: hasAlphaChannel ? "NOT_DECODED" : "NO_ALPHA_CHANNEL",
    hasTransparentPixels: hasAlphaChannel ? null : false,
    transparentPixelRatio: hasAlphaChannel ? null : 0,
    visibleContentBounds: hasAlphaChannel ? null : { xPx: 0, yPx: 0, widthPx, heightPx },
    visibleCoverageRatio: hasAlphaChannel ? null : 1
  };
}

function probeWebp(buffer: Buffer): ImageFacts | null {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  const format = buffer.toString("ascii", 12, 16);

  if (format === "VP8X") {
    // Extended format: a flags byte, then 24-bit little-endian canvas
    // dimensions minus one. Bit 4 of the flags is the alpha flag.
    const flags = buffer.readUInt8(20);
    return webpFacts(buffer.readUIntLE(24, 3) + 1, buffer.readUIntLE(27, 3) + 1, (flags & 0x10) !== 0);
  }

  if (format === "VP8L") {
    // Lossless: signature byte 0x2F, then 14 bits width-1, 14 bits height-1,
    // then 1 bit "alpha is used".
    if (buffer.readUInt8(20) !== 0x2f) {
      return null;
    }
    const bits = buffer.readUInt32LE(21);
    return webpFacts((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1, ((bits >> 28) & 0x1) === 1);
  }

  if (format === "VP8 ") {
    // Lossy: a 3-byte frame tag, the 3-byte start code 9D 01 2A, then 14-bit
    // little-endian width and height. Plain lossy VP8 has no alpha channel.
    if (buffer.readUInt8(23) !== 0x9d || buffer.readUInt8(24) !== 0x01 || buffer.readUInt8(25) !== 0x2a) {
      return null;
    }
    const widthPx = buffer.readUInt16LE(26) & 0x3fff;
    const heightPx = buffer.readUInt16LE(28) & 0x3fff;
    return widthPx > 0 && heightPx > 0 ? webpFacts(widthPx, heightPx, false) : null;
  }

  return null;
}

/**
 * Measures an uploaded file, or returns null when this module genuinely cannot.
 *
 * `mimeType` selects the parser, but never supplies the answer: a file whose
 * bytes do not match the type it claims returns null rather than the claimed
 * type's usual dimensions.
 */
export function probeImageFacts(buffer: Buffer, mimeType: string): ImageFacts | null {
  switch (mimeType.toLowerCase()) {
    case "image/png":
      return probePng(buffer);
    case "image/jpeg":
      return probeJpeg(buffer);
    case "image/webp":
      return probeWebp(buffer);
    default:
      // Video and audio need a real demuxer (ffprobe, which runs on the
      // Windows worker, not on this API host); documents have no single
      // pixel size. Null is reported as "never measured" all the way to the
      // slot gate, which blocks instead of assuming a fit.
      return null;
  }
}
