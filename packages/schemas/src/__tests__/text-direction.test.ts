import { describe, expect, it } from "vitest";
import { analyseTextDirection, textCodeUnits, textDirectionEvidenceSchema } from "../text-direction.js";

/**
 * Bidirectional-text analysis is derived from Unicode alone. These cases are
 * deliberately spread across unrelated scripts and shapes - Hebrew, Arabic,
 * mixed, Latin-only, digits, punctuation, multiline box text - so nothing
 * here can be satisfied by a rule that only happens to fit one template's
 * one Hebrew line.
 */
describe("analyseTextDirection", () => {
  it("treats a Hebrew-only line as right-to-left", () => {
    const analysis = analyseTextDirection("מבית");
    expect(analysis.requiredDirection).toBe("RTL");
    expect(analysis.hasRtl).toBe(true);
    expect(analysis.hasStrongLtr).toBe(false);
    expect(analysis.isMixed).toBe(false);
    expect(analysis.rtlScripts).toEqual(["Hebrew"]);
    expect(analysis.rtlCharacterCount).toBe(4);
  });

  it("treats an Arabic-only line as right-to-left", () => {
    const analysis = analyseTextDirection("مرحبا بالعالم");
    expect(analysis.requiredDirection).toBe("RTL");
    expect(analysis.rtlScripts).toEqual(["Arabic"]);
    expect(analysis.strongLtrCharacterCount).toBe(0);
  });

  it("treats mixed right-to-left and Latin text as a right-to-left paragraph", () => {
    const analysis = analyseTextDirection("מבית DYO App");
    expect(analysis.requiredDirection).toBe("RTL");
    expect(analysis.isMixed).toBe(true);
    expect(analysis.hasRtl).toBe(true);
    expect(analysis.hasStrongLtr).toBe(true);
    expect(analysis.rtlCharacterCount).toBe(4);
    expect(analysis.strongLtrCharacterCount).toBe(6);
  });

  it("reports every distinct right-to-left script that occurs", () => {
    const analysis = analyseTextDirection("שלום مرحبا");
    expect(analysis.requiredDirection).toBe("RTL");
    expect([...analysis.rtlScripts].sort()).toEqual(["Arabic", "Hebrew"]);
  });

  it("treats Latin-only text as left-to-right", () => {
    const analysis = analyseTextDirection("Perfect high-quality items");
    expect(analysis.requiredDirection).toBe("LTR");
    expect(analysis.hasRtl).toBe(false);
    expect(analysis.isMixed).toBe(false);
  });

  it("treats a non-Latin left-to-right script as left-to-right without enumerating it", () => {
    expect(analyseTextDirection("Привет").requiredDirection).toBe("LTR");
    expect(analyseTextDirection("こんにちは").requiredDirection).toBe("LTR");
  });

  it("treats digits, punctuation, whitespace and symbols as neutral - nothing justifies changing the template's own direction", () => {
    for (const neutral of ["", "   ", "12345", "!?.,-—()", "1,234.56 %", "★ ☆ ★", "\r\n"]) {
      const analysis = analyseTextDirection(neutral);
      expect(analysis.requiredDirection).toBe("NEUTRAL");
      expect(analysis.hasRtl).toBe(false);
      expect(analysis.hasStrongLtr).toBe(false);
    }
  });

  it("classifies right-to-left text that also carries digits and punctuation as right-to-left", () => {
    const analysis = analyseTextDirection("מחיר: 1,234.56 ₪");
    expect(analysis.requiredDirection).toBe("RTL");
    expect(analysis.hasRtl).toBe(true);
  });

  it("handles multiline box text, counting every line's characters", () => {
    const analysis = analyseTextDirection("שורה ראשונה\rשורה שנייה\nthird line");
    expect(analysis.requiredDirection).toBe("RTL");
    expect(analysis.isMixed).toBe(true);
    expect(analysis.codeUnitCount).toBe("שורה ראשונה\rשורה שנייה\nthird line".length);
  });

  it("counts code units and code points separately for text outside the basic plane", () => {
    const analysis = analyseTextDirection("א🙂");
    expect(analysis.codeUnitCount).toBe(3);
    expect(analysis.codePointCount).toBe(2);
    expect(analysis.requiredDirection).toBe("RTL");
  });

  it("never mutates or reorders the text it analyses", () => {
    const original = "מבית DYO App";
    const copy = `${original}`;
    analyseTextDirection(original);
    expect(original).toBe(copy);
  });
});

describe("textCodeUnits", () => {
  it("returns the exact UTF-16 sequence After Effects' own charCodeAt would see, in order", () => {
    expect(textCodeUnits("מבית DYO App")).toEqual([0x05de, 0x05d1, 0x05d9, 0x05ea, 0x20, 0x44, 0x59, 0x4f, 0x20, 0x41, 0x70, 0x70]);
  });

  it("keeps a surrogate pair as its two code units rather than one code point", () => {
    expect(textCodeUnits("🙂")).toHaveLength(2);
  });

  it("is order-sensitive, so a reversed string never verifies as equal", () => {
    const forward = textCodeUnits("שלום");
    const reversed = textCodeUnits([..."שלום"].reverse().join(""));
    expect(reversed).not.toEqual(forward);
  });
});

describe("textDirectionEvidenceSchema", () => {
  it("accepts a full evidence record", () => {
    const parsed = textDirectionEvidenceSchema.parse({
      requiredDirection: "RTL",
      rtlScripts: ["Hebrew"],
      isMixed: true,
      previousDirection: "0",
      previousComposerEngine: "0",
      appliedDirection: "1",
      appliedComposerEngine: "2",
      directionVerified: true,
      composerVerified: true,
      textCodeUnitsVerified: true,
      codeUnitCount: 12,
      note: null
    });
    expect(parsed.requiredDirection).toBe("RTL");
  });

  it("defaults the optional evidence fields so an older worker's record still parses", () => {
    const parsed = textDirectionEvidenceSchema.parse({
      requiredDirection: "LTR",
      isMixed: false,
      previousDirection: null,
      previousComposerEngine: null,
      appliedDirection: null,
      appliedComposerEngine: null,
      directionVerified: true,
      composerVerified: true,
      textCodeUnitsVerified: true,
      codeUnitCount: 3
    });
    expect(parsed.rtlScripts).toEqual([]);
    expect(parsed.note).toBeNull();
  });
});
