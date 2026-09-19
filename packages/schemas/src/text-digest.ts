import { z } from "zod";

/**
 * ONE CANONICAL TEXT-DIGEST ALGORITHM (2026-09-19).
 *
 * WHY THIS EXISTS: leftover-template-copy detection compares an approved
 * mapping with the template's own text. Carrying every template text in full
 * through an MCP response, a manifest and a browser payload is not safe for a
 * pathological template, so long text is stored as a bounded PREVIEW - but a
 * preview cannot be compared, and "re-run template inspection" can never fix a
 * text that is simply longer than the bound. That was a permanent dead end.
 *
 * The fix is to store, alongside the preview, verification metadata computed
 * from the COMPLETE text: its exact code-unit length and four digests (exact,
 * case-folded, whitespace-stripped, and both). Those are enough to decide
 * every question the gate actually asks - identical, case-only variant,
 * whitespace-only variant, or genuinely different - without ever storing or
 * transmitting the whole text.
 *
 * ONE ALGORITHM, EVERY BOUNDARY. This module is pure TypeScript with no
 * platform API: the same code runs in the worker (Node), the API (Node) and
 * the dashboard (browser), so a digest computed anywhere is byte-identical
 * everywhere. `node:crypto` is deliberately NOT used - it does not exist in a
 * browser, and two implementations would be two chances to drift. The test
 * suite pins this implementation against `node:crypto` for exactly that
 * reason.
 */

/** Bumped only if the canonical algorithm itself ever changes; stored with every digest so an older record is never silently compared under newer rules. */
export const TEXT_DIGEST_ALGORITHM = "sha256-utf8-v1" as const;

/* ------------------------------------------------------------------ *
 * SHA-256, pure and synchronous.
 * ------------------------------------------------------------------ */

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotateRight(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/** SHA-256 over raw bytes, returned as lowercase hex. */
export function sha256HexOfBytes(bytes: readonly number[]): string {
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

  // Padding: one 0x80 byte, then zeros, then the 64-bit big-endian bit length.
  const bitLength = bytes.length * 8;
  const padded = [...bytes, 0x80];
  while (padded.length % 64 !== 56) {
    padded.push(0);
  }
  // JavaScript numbers hold the full bit length exactly for any realistic
  // text (2^53 bits is ~1 petabyte), so the high word is derived by division
  // rather than by a 32-bit shift, which would overflow.
  const highWord = Math.floor(bitLength / 0x100000000);
  const lowWord = bitLength >>> 0;
  padded.push((highWord >>> 24) & 0xff, (highWord >>> 16) & 0xff, (highWord >>> 8) & 0xff, highWord & 0xff);
  padded.push((lowWord >>> 24) & 0xff, (lowWord >>> 16) & 0xff, (lowWord >>> 8) & 0xff, lowWord & 0xff);

  const w = new Array<number>(64);
  for (let chunkStart = 0; chunkStart < padded.length; chunkStart += 64) {
    for (let i = 0; i < 16; i += 1) {
      const offset = chunkStart + i * 4;
      w[i] = (((padded[offset] as number) << 24) | ((padded[offset + 1] as number) << 16) | ((padded[offset + 2] as number) << 8) | (padded[offset + 3] as number)) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15] as number;
      const b = w[i - 2] as number;
      const s0 = (rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3)) >>> 0;
      const s1 = (rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10)) >>> 0;
      w[i] = (((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i += 1) {
      const s1 = (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + s1 + ch + (K[i] as number) + (w[i] as number)) >>> 0;
      const s0 = (rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = ((hash[0] as number) + a) >>> 0;
    hash[1] = ((hash[1] as number) + b) >>> 0;
    hash[2] = ((hash[2] as number) + c) >>> 0;
    hash[3] = ((hash[3] as number) + d) >>> 0;
    hash[4] = ((hash[4] as number) + e) >>> 0;
    hash[5] = ((hash[5] as number) + f) >>> 0;
    hash[6] = ((hash[6] as number) + g) >>> 0;
    hash[7] = ((hash[7] as number) + h) >>> 0;
  }

  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

/**
 * UTF-8 bytes of a JavaScript string, done explicitly rather than through
 * `TextEncoder`/`Buffer` so the encoding is identical on every runtime and is
 * itself testable. A lone surrogate (possible in a JS string, and therefore
 * possible in a template) is encoded as U+FFFD, exactly as `TextEncoder`
 * does, so an unpaired half can never make two different texts hash alike.
 */
export function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let codePoint = text.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = (codePoint - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
        index += 1;
      } else {
        codePoint = 0xfffd;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }

    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    }
  }
  return bytes;
}

/** SHA-256 of a string's UTF-8 bytes, lowercase hex - the one hashing entry point this project uses for text. */
export function sha256Hex(text: string): string {
  return sha256HexOfBytes(utf8Bytes(text));
}

/* ------------------------------------------------------------------ *
 * Canonical normalizations.
 * ------------------------------------------------------------------ */

/**
 * Every code point treated as whitespace, listed explicitly rather than left
 * to a `\s` regex whose meaning differs between engines and Unicode versions.
 * Matches ECMAScript's own WhiteSpace + LineTerminator production, which is
 * what `String.prototype.trim` and `/\s/` mean on a modern engine.
 */
const WHITESPACE_CODE_POINTS = new Set([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x0085, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008,
  0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff
]);

/** Removes every whitespace character entirely (never collapses to one space), so "A B" and "A\r\nB" and "AB" normalise alike. */
export function stripWhitespace(text: string): string {
  let out = "";
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && WHITESPACE_CODE_POINTS.has(codePoint)) {
      continue;
    }
    out += character;
  }
  return out;
}

/** Locale-independent lowercasing (`toLowerCase`, never `toLocaleLowerCase`), so the same plan is judged identically on every machine. */
export function foldCase(text: string): string {
  return text.toLowerCase();
}

/* ------------------------------------------------------------------ *
 * Verification metadata.
 * ------------------------------------------------------------------ */

/**
 * Everything needed to compare a text that is NOT stored in full - computed
 * from the complete text, never from a preview. Four digests answer the gate's
 * four questions; the code-unit length is carried for evidence and for cheap
 * inequality.
 */
export const textVerificationSchema = z
  .object({
    algorithm: z.literal(TEXT_DIGEST_ALGORITHM),
    /** UTF-16 code units of the COMPLETE text - what After Effects' own String.length reports. */
    codeUnitLength: z.number().int().nonnegative(),
    /** Exact text. */
    fullDigest: z.string().length(64),
    /** Lowercased. */
    caseFoldedDigest: z.string().length(64),
    /** All whitespace removed. */
    whitespaceStrippedDigest: z.string().length(64),
    /** Lowercased AND whitespace removed. */
    caseFoldedWhitespaceStrippedDigest: z.string().length(64)
  })
  .strict();
export type TextVerification = z.infer<typeof textVerificationSchema>;

/** Computes all verification metadata for a COMPLETE text. Never call this with a preview. */
export function computeTextVerification(text: string): TextVerification {
  const stripped = stripWhitespace(text);
  return {
    algorithm: TEXT_DIGEST_ALGORITHM,
    codeUnitLength: text.length,
    fullDigest: sha256Hex(text),
    caseFoldedDigest: sha256Hex(foldCase(text)),
    whitespaceStrippedDigest: sha256Hex(stripped),
    caseFoldedWhitespaceStrippedDigest: sha256Hex(foldCase(stripped))
  };
}

/** How one complete text relates to another, decided from verification metadata alone. Mirrors the direct string comparison exactly, so a digest-based verdict and a full-text verdict can never disagree. */
export function compareByVerification(
  candidate: TextVerification,
  reference: TextVerification
): { identical: boolean; caseOnly: boolean; whitespaceOnly: boolean; caseAndWhitespaceOnly: boolean } {
  const identical = candidate.fullDigest === reference.fullDigest;
  return {
    identical,
    caseOnly: !identical && candidate.caseFoldedDigest === reference.caseFoldedDigest,
    whitespaceOnly: !identical && candidate.whitespaceStrippedDigest === reference.whitespaceStrippedDigest,
    caseAndWhitespaceOnly: !identical && candidate.caseFoldedWhitespaceStrippedDigest === reference.caseFoldedWhitespaceStrippedDigest
  };
}
