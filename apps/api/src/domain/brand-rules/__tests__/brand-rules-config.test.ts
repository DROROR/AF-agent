import { describe, expect, it } from "vitest";
import { loadBrandRulesConfig } from "../brand-rules-config.js";

describe("loadBrandRulesConfig", () => {
  it("loads and validates the real repo-root dyo-brand-rules.yaml", () => {
    // No pathOverride/DYO_BRAND_RULES_PATH - proves the real artifact
    // required by CLAUDE.md's "Required Data Model" actually exists,
    // parses, and satisfies the schema, not merely that the code compiles.
    const config = loadBrandRulesConfig();
    expect(config.requireLogoPresence).toBe(true);
    expect(config.requiredHebrewText).toBe("מבית DYO App");
    expect(config.rtlPreservedByConstruction).toBe(true);
    // Deliberately not asserting a specific dyoBlueHex value - it is null
    // until the client supplies the real one (see the yaml's own doc
    // comment) and this test must keep passing once they do.
  });

  it("rejects a malformed brand-rules file rather than silently defaulting", () => {
    expect(() => loadBrandRulesConfig("/nonexistent/dyo-brand-rules.yaml")).toThrow();
  });

  /**
   * Live QA brand-rule blocker fix, 2026-09-08 codepoint audit: proves the
   * real, logical Unicode codepoint sequence of the required Hebrew text's
   * own letters, not merely a string-equality check against another
   * literal in this same file (a terminal/editor RTL-rendering mishap
   * could in principle mangle BOTH this test's own literal and the real
   * yaml identically, defeating a plain .toBe comparison - explicit
   * numeric codepoints have no directionality to get confused by).
   * מבית is CORRECT: U+05DE (מ) U+05D1 (ב) U+05D9 (י) U+05EA (ת), in that
   * logical order. The reversed form, תיבמ (U+05EA U+05D9 U+05D1 U+05DE -
   * the exact same four codepoints, reverse order), must never pass.
   */
  it("the required Hebrew text's own codepoint sequence is logically exactly מבית - never the reversed form", () => {
    const config = loadBrandRulesConfig();
    const hebrewPrefix = config.requiredHebrewText.split(" ")[0]!;
    const codepoints = [...hebrewPrefix].map((char) => char.codePointAt(0));
    const CORRECT_CODEPOINTS = [0x05de, 0x05d1, 0x05d9, 0x05ea]; // מ ב י ת, in that logical order
    const REVERSED_CODEPOINTS = [0x05ea, 0x05d9, 0x05d1, 0x05de]; // ת י ב מ - the wrong, reversed form
    expect(codepoints).toEqual(CORRECT_CODEPOINTS);
    expect(codepoints).not.toEqual(REVERSED_CODEPOINTS);
    expect(config.requiredHebrewText).toBe("מבית DYO App");
  });
});
