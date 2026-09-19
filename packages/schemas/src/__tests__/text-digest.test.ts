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
  utf8Bytes
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

  it("matches node:crypto's SHA-256 over UTF-8 for every case", () => {
    for (const text of cases) {
      expect(sha256Hex(text)).toBe(createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex"));
    }
  });

  it("encodes UTF-8 exactly as TextEncoder does, including astral characters", () => {
    for (const text of cases) {
      expect(Uint8Array.from(utf8Bytes(text))).toEqual(new TextEncoder().encode(text));
    }
  });

  it("encodes a lone surrogate exactly as TextEncoder does - as U+FFFD", () => {
    // Both halves become the replacement character, in this implementation and
    // in TextEncoder alike, so two texts differing only in WHICH unpaired half
    // they contain do hash the same. That is standard UTF-8 encoding
    // behaviour, not a shortcut here: the point of this case is that the
    // digest never diverges from the platform encoder. A lone surrogate cannot
    // survive a round trip through a real file anyway, and any text short
    // enough to be stored in full is compared exactly, not by digest.
    for (const half of ["\ud800", "\udc00"]) {
      expect(Uint8Array.from(utf8Bytes(half))).toEqual(new TextEncoder().encode(half));
      expect(sha256Hex(half)).toBe(createHash("sha256").update(Buffer.from(half, "utf8")).digest("hex"));
    }
  });

  it("digests a multi-megabyte text correctly (block padding across many chunks)", () => {
    const huge = "λ🙂 mixed ".repeat(200_000);
    expect(sha256Hex(huge)).toBe(createHash("sha256").update(Buffer.from(huge, "utf8")).digest("hex"));
  });

  it("is stable across calls and independent of how the string was built", () => {
    const built = ["Assets", " and ", "more"].join("");
    expect(sha256Hex(built)).toBe(sha256Hex("Assets and more"));
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
    expect(foldCase("ΣΊΣΥΦΟΣ")).toBe("ΣΊΣΥΦΟΣ".toLowerCase());
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
