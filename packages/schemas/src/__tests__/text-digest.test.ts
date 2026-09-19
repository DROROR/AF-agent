import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  TEXT_DIGEST_ALGORITHM,
  compareByVerification,
  computeTextVerification,
  foldCase,
  sha256Hex,
  stripWhitespace,
  textVerificationSchema,
  utf16leBytes,
  TextVerificationStream
} from "../text-digest.js";

/**
 * ONE CANONICAL ALGORITHM, PROVEN ACROSS BOUNDARIES.
 *
 * The digest implementation is pure TypeScript so the worker (Node), the API
 * (Node) and the dashboard (browser) can all compute it - which only helps if
 * it genuinely agrees with a known-correct implementation. These cases pin it
 * against `node:crypto` and `TextEncoder`, the two references every other
 * runtime is itself checked against.
 */
describe("canonical digest, checked against node:crypto", () => {
  const cases = [
    "",
    "a",
    "Assets",
    "The quick brown fox",
    "מבית DYO App",
    "مرحبا بالعالم",
    "line one\rline two\nline three",
    "🙂 astral start",
    "trailing astral 👨‍👩‍👧‍👦",
    "x".repeat(10_000),
    "y".repeat(10_001),
    " 　  unicode whitespace ﻿"
  ];

  it("matches node:crypto's SHA-256 over the same UTF-16LE bytes for every case", () => {
    for (const text of cases) {
      expect(sha256Hex(text)).toBe(createHash("sha256").update(Buffer.from(text, "utf16le")).digest("hex"));
      expect(sha256Hex(text)).toBe(createHash("sha256").update(Buffer.from(utf16leBytes(text))).digest("hex"));
    }
  });

  it("encodes each code unit as two little-endian bytes, with no BOM", () => {
    expect(utf16leBytes("A")).toEqual([0x41, 0x00]);
    expect(utf16leBytes("\u{1f642}")).toEqual([0x3d, 0xd8, 0x42, 0xde]);
    expect(utf16leBytes("")).toEqual([]);
    for (const text of cases) {
      expect(Uint8Array.from(utf16leBytes(text))).toEqual(new Uint8Array(Buffer.from(text, "utf16le")));
    }
  });


  it("digests a multi-megabyte text correctly (block padding across many chunks)", () => {
    const huge = "λ🙂 mixed ".repeat(200_000);
    expect(sha256Hex(huge)).toBe(createHash("sha256").update(Buffer.from(huge, "utf16le")).digest("hex"));
  });

  it("is stable across calls and independent of how the string was built", () => {
    const built = ["Assets", " and ", "more"].join("");
    expect(sha256Hex(built)).toBe(sha256Hex("Assets and more"));
  });
});

/**
 * INTEGRITY: the digest must preserve EVERY possible JavaScript string
 * distinctly. The earlier UTF-8 encoding could not - it mapped every unpaired
 * surrogate to U+FFFD, so three different strings hashed alike. Hashing the
 * UTF-16 code units directly is injective, and these cases hold it to that.
 */
describe("every distinct JavaScript string gets a distinct digest", () => {
  const HIGH_LONE = "\ud800";
  const LOW_LONE = "\udc00";
  const PAIR = "\ud83d\ude42"; // U+1F642, a valid surrogate pair
  const REPLACEMENT = "\ufffd";

  it("keeps a high lone surrogate, a low lone surrogate, U+FFFD and a valid pair all distinct", () => {
    const digests = [HIGH_LONE, LOW_LONE, REPLACEMENT, PAIR].map(sha256Hex);
    expect(new Set(digests).size).toBe(4);
  });

  it("keeps a lone surrogate distinct from the same surrogate inside a valid pair", () => {
    expect(sha256Hex(HIGH_LONE)).not.toBe(sha256Hex(PAIR));
    expect(sha256Hex(`${HIGH_LONE}x`)).not.toBe(sha256Hex(`${PAIR}x`));
  });

  it("keeps an astral character distinct from its two code units written separately around other text", () => {
    expect(sha256Hex(`a${PAIR}b`)).not.toBe(sha256Hex(`a${HIGH_LONE}b${LOW_LONE}`));
  });

  it("keeps composed and decomposed Unicode distinct - normalisation is never applied silently", () => {
    const composed = "Caf\u00e9";
    const decomposed = "Cafe\u0301";
    expect(composed).not.toBe(decomposed);
    expect(sha256Hex(composed)).not.toBe(sha256Hex(decomposed));
    // ...and their normalized variants stay distinct too, since case folding
    // and whitespace stripping never normalise composition.
    const a = computeTextVerification(composed);
    const b = computeTextVerification(decomposed);
    expect(a.caseFoldedDigest).not.toBe(b.caseFoldedDigest);
    expect(a.whitespaceStrippedDigest).not.toBe(b.whitespaceStrippedDigest);
  });

  it("gives equal digests to strings that ARE equal, whatever they contain", () => {
    for (const text of [HIGH_LONE, LOW_LONE, PAIR, REPLACEMENT, `mixed ${PAIR}${HIGH_LONE} tail`]) {
      expect(sha256Hex(text)).toBe(sha256Hex(`${text}`));
      expect(computeTextVerification(text)).toEqual(computeTextVerification(`${text}`));
    }
  });

  it("names the algorithm it used, so an older record is never compared under newer rules", () => {
    expect(computeTextVerification("x").algorithm).toBe("sha256-utf16le-code-units-v1");
    expect(TEXT_DIGEST_ALGORITHM).toBe("sha256-utf16le-code-units-v1");
  });
});

/**
 * STREAMING: a text too large to hold is verified a slice at a time, so the
 * streamed digests must equal the whole-string ones for every chunking -
 * including chunk boundaries that fall inside a surrogate pair.
 */
describe("TextVerificationStream", () => {
  function streamed(text: string, chunkSize: number) {
    const stream = new TextVerificationStream();
    for (let index = 0; index < text.length; index += chunkSize) {
      stream.update(text.slice(index, index + chunkSize));
    }
    return stream.finish();
  }

  const samples = [
    "",
    "Assets",
    "a🙂b🙃c",
    "Mixed CASE and\r\n whitespace\u00a0here",
    "\ud800 lone high, \udc00 lone low",
    `${"long ".repeat(5_000)}tail`
  ];

  it("matches the whole-string result at every chunk size, including pair-splitting ones", () => {
    for (const text of samples) {
      const whole = computeTextVerification(text);
      for (const chunkSize of [1, 2, 3, 5, 17, 64, 4_096]) {
        expect(streamed(text, chunkSize)).toEqual(whole);
      }
    }
  });

  it("reassembles a surrogate pair split exactly across a chunk boundary", () => {
    const text = `${"p".repeat(9)}🙂 tail`;
    // Chunk size 10 puts the split precisely between the pair's two halves.
    expect(streamed(text, 10)).toEqual(computeTextVerification(text));
  });

  it("counts code units, not chunks", () => {
    const text = "a🙂b";
    expect(streamed(text, 1).codeUnitLength).toBe(text.length);
  });
});

describe("canonical normalizations", () => {
  it("removes every whitespace character rather than collapsing it", () => {
    expect(stripWhitespace("A B\tC\r\nD E　F")).toBe("ABCDEF");
    expect(stripWhitespace("   ")).toBe("");
  });

  it("does not treat a non-whitespace Unicode character as whitespace", () => {
    expect(stripWhitespace("A​B")).toBe("A​B");
  });

  it("folds case without depending on the host locale", () => {
    expect(foldCase("ASSETS")).toBe("assets");
    expect(foldCase("МОСКВА")).toBe("москва");
  });

  it("folds PER CODE POINT, so the result never depends on surrounding characters", () => {
    // Whole-string toLowerCase is context sensitive: a Greek capital sigma at
    // the end of a word becomes a FINAL sigma. That verdict would change with
    // where a slice boundary happened to fall, so the canonical fold is
    // deliberately per code point - the streaming path and the whole-string
    // path then agree by construction.
    expect("ΣΊΣΥΦΟΣ".toLowerCase()).toBe("σίσυφος");
    expect(foldCase("ΣΊΣΥΦΟΣ")).toBe("σίσυφοσ");
    // The property that matters: folding a text equals folding its pieces.
    const text = "ΑΒΓ ΣΊΣΥΦΟΣ δεζ";
    for (const size of [1, 2, 4, 7]) {
      let piecewise = "";
      for (let index = 0; index < text.length; index += size) {
        piecewise += foldCase(text.slice(index, index + size));
      }
      expect(piecewise).toBe(foldCase(text));
    }
  });

  it("keeps an astral character's case fold intact (no lone-surrogate folding)", () => {
    expect(foldCase("🙂")).toBe("🙂");
    expect(foldCase("\ud800")).toBe("\ud800");
  });
});

describe("computeTextVerification", () => {
  it("reports the algorithm, the exact code-unit length and four digests", () => {
    const verification = computeTextVerification("Free!");
    expect(verification.algorithm).toBe(TEXT_DIGEST_ALGORITHM);
    expect(verification.codeUnitLength).toBe(5);
    expect(() => textVerificationSchema.parse(verification)).not.toThrow();
  });

  it("counts code units, not code points, so astral characters are measured as After Effects measures them", () => {
    expect(computeTextVerification("🙂").codeUnitLength).toBe(2);
  });

  it("gives identical texts identical digests, and different texts different ones", () => {
    expect(computeTextVerification("Assets")).toEqual(computeTextVerification("Assets"));
    expect(computeTextVerification("Assets").fullDigest).not.toBe(computeTextVerification("Asset").fullDigest);
  });
});

describe("compareByVerification", () => {
  const of = (text: string) => computeTextVerification(text);

  it("recognises identical text", () => {
    expect(compareByVerification(of("Assets"), of("Assets"))).toMatchObject({ identical: true, caseOnly: false });
  });

  it("recognises a case-only difference", () => {
    expect(compareByVerification(of("ASSETS"), of("Assets"))).toMatchObject({ identical: false, caseOnly: true });
  });

  it("recognises a whitespace-only difference", () => {
    expect(compareByVerification(of(" Assets  "), of("Assets"))).toMatchObject({ identical: false, whitespaceOnly: true });
  });

  it("recognises a combined case-and-whitespace difference", () => {
    const comparison = compareByVerification(of("assets "), of("Assets"));
    expect(comparison.identical).toBe(false);
    expect(comparison.caseOnly).toBe(false);
    expect(comparison.whitespaceOnly).toBe(false);
    expect(comparison.caseAndWhitespaceOnly).toBe(true);
  });

  it("recognises a genuine difference", () => {
    expect(compareByVerification(of("Your own words"), of("Assets"))).toMatchObject({
      identical: false,
      caseOnly: false,
      whitespaceOnly: false,
      caseAndWhitespaceOnly: false
    });
  });

  it("agrees with a direct string comparison for very long texts differing only after the storage bound", () => {
    const shared = "z".repeat(10_000);
    const a = `${shared}first ending`;
    const b = `${shared}second ending`;
    expect(compareByVerification(of(a), of(b)).identical).toBe(false);
    expect(compareByVerification(of(a), of(a)).identical).toBe(true);
  });
});
