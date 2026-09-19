import { z } from "zod";

/**
 * ONE CANONICAL TEXT-DIGEST ALGORITHM (2026-09-19).
 *
 * WHY THIS EXISTS: leftover-template-copy detection compares an approved
 * mapping with the template's own text. Carrying every template text in full
 * through an MCP response, a manifest and a browser payload is not safe for a
 * pathological template, so long text is stored as a bounded PREVIEW - but a
 * preview cannot be compared, and "re-run template inspection" can never fix a
 * text that is simply longer than the bound. Verification metadata computed
 * from the COMPLETE text closes that loop: exact code-unit length plus four
 * digests (exact, case-folded, whitespace-stripped, and both).
 *
 * UTF-16 CODE UNITS, NOT UTF-8 (2026-09-19 integrity correction). After
 * Effects and JavaScript both hold text as UTF-16, and a UTF-16 string can
 * contain an unpaired surrogate. Encoding to UTF-8 first maps EVERY unpaired
 * surrogate to U+FFFD, so "\uD800", "\uDC00" and "�" all hashed alike -
 * a real collision in a system whose whole job is exact verification. This
 * module therefore hashes the string's own UTF-16 code units directly, little
 * endian, two bytes each, with no BOM: that mapping is injective over every
 * possible JavaScript string, so distinct strings always produce distinct
 * digest inputs.
 *
 * ONE ALGORITHM, EVERY BOUNDARY. Pure TypeScript with no platform API: the
 * same code runs in the worker (Node), the API (Node) and the dashboard
 * (browser), so a digest computed anywhere is byte-identical everywhere.
 * `node:crypto` is deliberately NOT used - it does not exist in a browser,
 * and two implementations would be two chances to drift. The test suite pins
 * the hash against `node:crypto` (fed the same UTF-16LE bytes) for exactly
 * that reason.
 */

/**
 * Stored with every digest record, so a record written under an older
 * algorithm is never silently compared under newer rules. The previous
 * `sha256-utf8-v1` is deliberately NOT accepted anywhere: it could not
 * distinguish an unpaired surrogate from U+FFFD.
 */
export const TEXT_DIGEST_ALGORITHM = "sha256-utf16le-code-units-v1" as const;

/* ------------------------------------------------------------------ *
 * SHA-256, pure, synchronous, and incremental.
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

/**
 * Incremental SHA-256: `update` as many times as needed, then `digest`.
 *
 * Incremental rather than one-shot so a text far too large to hold in memory
 * can still be verified exactly - the worker streams one bounded slice at a
 * time into these, and never assembles the whole string (see
 * complete-template-text.ts).
 */
export class Sha256Stream {
  private readonly state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  private readonly block = new Uint8Array(64);
  private blockLength = 0;
  private totalBytes = 0;
  private readonly w = new Array<number>(64);

  update(bytes: ArrayLike<number>): this {
    for (let index = 0; index < bytes.length; index += 1) {
      this.block[this.blockLength] = (bytes[index] as number) & 0xff;
      this.blockLength += 1;
      this.totalBytes += 1;
      if (this.blockLength === 64) {
        this.compress();
        this.blockLength = 0;
      }
    }
    return this;
  }

  /** Finalises and returns lowercase hex. The instance must not be updated afterwards. */
  digest(): string {
    const bitLength = this.totalBytes * 8;
    const tail: number[] = [0x80];
    while ((this.blockLength + tail.length) % 64 !== 56) {
      tail.push(0);
    }
    // JavaScript numbers hold the full bit length exactly for any realistic
    // text (2^53 bits is ~1 petabyte), so the high word is derived by division
    // rather than a 32-bit shift, which would overflow.
    const highWord = Math.floor(bitLength / 0x100000000);
    const lowWord = bitLength >>> 0;
    tail.push((highWord >>> 24) & 0xff, (highWord >>> 16) & 0xff, (highWord >>> 8) & 0xff, highWord & 0xff);
    tail.push((lowWord >>> 24) & 0xff, (lowWord >>> 16) & 0xff, (lowWord >>> 8) & 0xff, lowWord & 0xff);
    // Padding must not count toward the length already recorded above.
    const recordedTotal = this.totalBytes;
    this.update(tail);
    this.totalBytes = recordedTotal;
    return this.state.map((word) => word.toString(16).padStart(8, "0")).join("");
  }

  private compress(): void {
    const w = this.w;
    for (let i = 0; i < 16; i += 1) {
      const offset = i * 4;
      w[i] = (((this.block[offset] as number) << 24) | ((this.block[offset + 1] as number) << 16) | ((this.block[offset + 2] as number) << 8) | (this.block[offset + 3] as number)) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15] as number;
      const b = w[i - 2] as number;
      const s0 = (rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3)) >>> 0;
      const s1 = (rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10)) >>> 0;
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = this.state as [number, number, number, number, number, number, number, number];
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
    this.state[0] = ((this.state[0] as number) + a) >>> 0;
    this.state[1] = ((this.state[1] as number) + b) >>> 0;
    this.state[2] = ((this.state[2] as number) + c) >>> 0;
    this.state[3] = ((this.state[3] as number) + d) >>> 0;
    this.state[4] = ((this.state[4] as number) + e) >>> 0;
    this.state[5] = ((this.state[5] as number) + f) >>> 0;
    this.state[6] = ((this.state[6] as number) + g) >>> 0;
    this.state[7] = ((this.state[7] as number) + h) >>> 0;
  }
}

/**
 * The string's own UTF-16 code units, little endian, two bytes each, no BOM.
 *
 * Injective over every JavaScript string - including one containing an
 * unpaired surrogate - which is exactly why this replaced UTF-8 encoding: a
 * high lone surrogate, a low lone surrogate and U+FFFD are three different
 * strings and must produce three different digests.
 */
export function utf16leBytes(text: string): number[] {
  const bytes: number[] = new Array<number>(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    bytes[index * 2] = codeUnit & 0xff;
    bytes[index * 2 + 1] = (codeUnit >>> 8) & 0xff;
  }
  return bytes;
}

/** SHA-256 of a string's UTF-16LE code units, lowercase hex - the one hashing entry point this project uses for text. */
export function sha256Hex(text: string): string {
  return new Sha256Stream().update(utf16leBytes(text)).digest();
}

/* ------------------------------------------------------------------ *
 * Canonical normalizations - both context-free, so both can stream.
 * ------------------------------------------------------------------ */

/**
 * Every code point treated as whitespace, listed explicitly rather than left
 * to a `\s` regex whose meaning differs between engines and Unicode versions.
 * Matches ECMAScript's own WhiteSpace + LineTerminator production.
 */
const WHITESPACE_CODE_POINTS = new Set([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x0085, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008,
  0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff
]);

/** True for a code point this project treats as whitespace. Per code point and context-free, so stripping can be done a chunk at a time. */
export function isCanonicalWhitespace(codePoint: number): boolean {
  return WHITESPACE_CODE_POINTS.has(codePoint);
}

/** Removes every whitespace character entirely (never collapses to one space), so "A B", "A\r\nB" and "AB" normalise alike. */
export function stripWhitespace(text: string): string {
  let out = "";
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && isCanonicalWhitespace(codePoint)) {
      continue;
    }
    out += character;
  }
  return out;
}

/**
 * Canonical case folding: lowercase applied PER CODE POINT.
 *
 * Deliberately not `wholeString.toLowerCase()`. Whole-string lowercasing is
 * context sensitive (Greek final sigma is the standard example: the same
 * capital sigma lowercases differently depending on what surrounds it), and a
 * context-sensitive fold cannot be computed a slice at a time - the verdict
 * would depend on where the slice boundaries happened to fall. Per-code-point
 * lowercasing is context-free, so the streaming path and the whole-string path
 * are guaranteed to agree, which matters far more here than matching
 * `toLowerCase` on the handful of context-sensitive code points.
 */
export function foldCase(text: string): string {
  let out = "";
  for (const character of text) {
    out += character.toLowerCase();
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Verification metadata.
 * ------------------------------------------------------------------ */

/**
 * Everything needed to compare a text that is NOT stored in full - computed
 * from the complete text, never from a preview. Four digests answer the gate's
 * four questions; the code-unit length is carried for evidence.
 */
export const textVerificationSchema = z
  .object({
    /**
     * Which canonical algorithm produced these digests. A plain string rather
     * than a literal so a record written by an older build still PARSES; the
     * gate then refuses to compare it, because a digest is only meaningful
     * under the algorithm that produced it.
     */
    algorithm: z.string().min(1),
    /** UTF-16 code units of the COMPLETE text - what After Effects' own String.length reports. */
    codeUnitLength: z.number().int().nonnegative(),
    /** Exact text. */
    fullDigest: z.string().length(64),
    /** Case-folded. */
    caseFoldedDigest: z.string().length(64),
    /** All whitespace removed. */
    whitespaceStrippedDigest: z.string().length(64),
    /** Case-folded AND whitespace removed. */
    caseFoldedWhitespaceStrippedDigest: z.string().length(64)
  })
  .strict();
export type TextVerification = z.infer<typeof textVerificationSchema>;

/**
 * How completely a template layer's own text was captured at inspection time.
 * Distinguishes the cases that need DIFFERENT advice from an operator:
 *
 * - `COMPLETE` - the whole text is stored on the placeholder.
 * - `VERIFIED_EXCERPT` - too long to store, but its digests were computed from
 *   the complete text, so it is fully verifiable.
 * - `CAPTURE_FAILED` - a transient failure while reading it (a dropped MCP
 *   call, a project that changed mid-read). Re-inspection may well resolve it.
 * - `TOO_LARGE` - beyond the size this system verifies at all. TERMINAL:
 *   re-inspection can never change it, so telling an operator to re-inspect
 *   would be an endless loop.
 *
 * An ABSENT status means the manifest predates text capture entirely.
 */
export const TEXT_CAPTURE_STATUSES = ["COMPLETE", "VERIFIED_EXCERPT", "CAPTURE_FAILED", "TOO_LARGE"] as const;
export const textCaptureStatusSchema = z.enum(TEXT_CAPTURE_STATUSES);
export type TextCaptureStatus = (typeof TEXT_CAPTURE_STATUSES)[number];

/**
 * The largest text this system verifies. A text beyond it is classified
 * TOO_LARGE rather than silently unverified: the digests themselves stream
 * and would cope, but each bounded slice costs a round trip to After Effects,
 * so an unbounded read is its own denial of service.
 */
export const MAX_VERIFIABLE_TEXT_CODE_UNITS = 2_000_000;

/** True when this record was produced by the algorithm currently in force, and may therefore be compared. */
export function isCurrentDigestAlgorithm(algorithm: string): boolean {
  return algorithm === TEXT_DIGEST_ALGORITHM;
}

/**
 * Computes all four digests incrementally, one chunk at a time, WITHOUT ever
 * holding the complete text.
 *
 * Both normalizations are context-free (see `foldCase`), so feeding the same
 * text in different chunk sizes always produces the same digests. The only
 * boundary hazard is a surrogate pair split across two chunks: a trailing high
 * surrogate is therefore carried over and re-joined with the next chunk before
 * normalisation, so the pair is always normalised as one character.
 */
export class TextVerificationStream {
  private readonly exact = new Sha256Stream();
  private readonly folded = new Sha256Stream();
  private readonly stripped = new Sha256Stream();
  private readonly foldedStripped = new Sha256Stream();
  private codeUnitLength = 0;
  /** A high surrogate seen at the very end of the previous chunk, whose pair may begin the next one. */
  private pendingHighSurrogate = "";

  update(chunk: string): this {
    if (chunk.length === 0) {
      return this;
    }
    this.codeUnitLength += chunk.length;

    // The EXACT digest is over raw code units, so it never needs the carry -
    // it can consume every chunk immediately, split pairs and all.
    this.exact.update(utf16leBytes(chunk));

    let working = this.pendingHighSurrogate + chunk;
    this.pendingHighSurrogate = "";
    const lastUnit = working.charCodeAt(working.length - 1);
    if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) {
      // Hold it back: its low half may arrive in the next chunk.
      this.pendingHighSurrogate = working.slice(-1);
      working = working.slice(0, -1);
    }
    this.consumeNormalised(working);
    return this;
  }

  /** Finalises every digest. Any held-back lone high surrogate is normalised on its own, exactly as a whole-string pass would treat it. */
  finish(): TextVerification {
    if (this.pendingHighSurrogate !== "") {
      this.consumeNormalised(this.pendingHighSurrogate);
      this.pendingHighSurrogate = "";
    }
    return {
      algorithm: TEXT_DIGEST_ALGORITHM,
      codeUnitLength: this.codeUnitLength,
      fullDigest: this.exact.digest(),
      caseFoldedDigest: this.folded.digest(),
      whitespaceStrippedDigest: this.stripped.digest(),
      caseFoldedWhitespaceStrippedDigest: this.foldedStripped.digest()
    };
  }

  private consumeNormalised(text: string): void {
    if (text.length === 0) {
      return;
    }
    const folded = foldCase(text);
    const stripped = stripWhitespace(text);
    this.folded.update(utf16leBytes(folded));
    this.stripped.update(utf16leBytes(stripped));
    this.foldedStripped.update(utf16leBytes(foldCase(stripped)));
  }
}

/** Computes all verification metadata for a COMPLETE text held in memory. Never call this with a preview. */
export function computeTextVerification(text: string): TextVerification {
  return new TextVerificationStream().update(text).finish();
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
