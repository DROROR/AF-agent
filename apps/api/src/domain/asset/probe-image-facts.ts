/**
 * REAL MEASURED IMAGE FACTS, FROM THE FILE'S OWN BYTES (Stage 4, 2026-09-19).
 *
 * The slot gate judges whether an asset belongs in a slot, and whether it will
 * fit, from dimensions, aspect ratio and transparency. None of those may come
 * from a filename, a client-supplied field, or a guess: they are read out of
 * the encoded header of the file that was actually uploaded.
 *
 * Only the image formats this system accepts are parsed (PNG, JPEG, WebP - see
 * mime-allowlist.ts). Video, audio and documents return null: this module does
 * not pretend to measure what it cannot, and a null propagates to the gate as
 * an honest "never measured", which blocks rather than passes.
 *
 * Nothing here executes or decodes pixel data - it reads sizes and flags out of
 * fixed header positions, with every read bounds-checked, and returns null for
 * anything truncated, unrecognized or self-inconsistent.
 */

export interface ImageFacts {
  widthPx: number;
  heightPx: number;
  /**
   * Whether the encoding can carry per-pixel transparency. This is a fact
   * about the FORMAT AND ITS FLAGS (a PNG with an alpha channel, a WebP whose
   * header sets the alpha bit), not a claim that any pixel is actually
   * transparent - proving that would need a full decode. A JPEG is always
   * false, because the format has no alpha channel at all.
   */
  hasAlpha: boolean;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Chunk-walk bound: a header's transparency flag lives near the front, and an unbounded walk over a hostile file is not worth the pixels. */
const MAX_PNG_CHUNKS_SCANNED = 64;
/** Same bound for JPEG's own marker walk. */
const MAX_JPEG_MARKERS_SCANNED = 256;

function probePng(buffer: Buffer): ImageFacts | null {
  // Signature, then the mandatory IHDR chunk: [length:4][type:4][data:13].
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString("ascii", 12, 16) !== "IHDR") {
    return null;
  }
  const widthPx = buffer.readUInt32BE(16);
  const heightPx = buffer.readUInt32BE(20);
  const colorType = buffer.readUInt8(25);
  if (widthPx === 0 || heightPx === 0) {
    return null;
  }

  // Colour types 4 (grey+alpha) and 6 (RGB+alpha) carry a real alpha channel.
  // Types 0/2/3 can still be transparent via a tRNS chunk, which is a genuine
  // transparency declaration and is treated as one.
  if (colorType === 4 || colorType === 6) {
    return { widthPx, heightPx, hasAlpha: true };
  }
  let offset = 8;
  for (let chunk = 0; chunk < MAX_PNG_CHUNKS_SCANNED; chunk += 1) {
    if (offset + 8 > buffer.length) {
      break;
    }
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "tRNS") {
      return { widthPx, heightPx, hasAlpha: true };
    }
    if (type === "IDAT" || type === "IEND") {
      break; // Transparency is declared before the image data.
    }
    // length + the 4-byte CRC that follows every chunk's data.
    offset += 12 + length;
  }
  return { widthPx, heightPx, hasAlpha: false };
}

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
      // JPEG has no alpha channel in any of its baseline/progressive forms.
      return widthPx > 0 && heightPx > 0 ? { widthPx, heightPx, hasAlpha: false } : null;
    }
    if (code === 0xda) {
      return null; // Entropy-coded data begins; no frame header was found.
    }
    offset += 1 + segmentLength;
  }
  return null;
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
    const widthPx = buffer.readUIntLE(24, 3) + 1;
    const heightPx = buffer.readUIntLE(27, 3) + 1;
    return { widthPx, heightPx, hasAlpha: (flags & 0x10) !== 0 };
  }

  if (format === "VP8L") {
    // Lossless: signature byte 0x2F, then 14 bits width-1, 14 bits height-1,
    // then 1 bit "alpha is used".
    if (buffer.readUInt8(20) !== 0x2f) {
      return null;
    }
    const bits = buffer.readUInt32LE(21);
    const widthPx = (bits & 0x3fff) + 1;
    const heightPx = ((bits >> 14) & 0x3fff) + 1;
    const alphaIsUsed = ((bits >> 28) & 0x1) === 1;
    return { widthPx, heightPx, hasAlpha: alphaIsUsed };
  }

  if (format === "VP8 ") {
    // Lossy: a 3-byte frame tag, the 3-byte start code 9D 01 2A, then 14-bit
    // little-endian width and height. Plain lossy VP8 has no alpha channel.
    if (buffer.readUInt8(23) !== 0x9d || buffer.readUInt8(24) !== 0x01 || buffer.readUInt8(25) !== 0x2a) {
      return null;
    }
    const widthPx = buffer.readUInt16LE(26) & 0x3fff;
    const heightPx = buffer.readUInt16LE(28) & 0x3fff;
    return widthPx > 0 && heightPx > 0 ? { widthPx, heightPx, hasAlpha: false } : null;
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
