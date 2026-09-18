import { describe, expect, it } from "vitest";
import { assessTemplateCopy, templateTextDecisionRecordSchema, type TemplateTextDecisionRecord } from "../template-copy.js";

const DECIDED_AT = "2026-01-01T00:00:00.000Z";

function decision(overrides: Partial<TemplateTextDecisionRecord> & { textAtDecision: string }): TemplateTextDecisionRecord {
  return { decision: "KEEP_TEMPLATE_TEXT", decidedBy: "user-1", decidedAt: DECIDED_AT, ...overrides };
}

/**
 * These cases deliberately use wording from several imaginary templates, in
 * several scripts, so nothing here can be satisfied by a rule that only fits
 * the one project that motivated the gate.
 */
describe("assessTemplateCopy", () => {
  it("blocks text identical to the template's own wording", () => {
    const result = assessTemplateCopy({ mappingText: "Assets", templateText: "Assets", decision: null });
    expect(result.status).toBe("IDENTICAL");
    expect(result.blocks).toBe(true);
    expect(result.reason).toContain("identical to the template's own wording");
  });

  it("passes genuinely replaced text", () => {
    const result = assessTemplateCopy({ mappingText: "Your app, your brand", templateText: "Assets", decision: null });
    expect(result.status).toBe("REPLACED");
    expect(result.blocks).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("compares exact code points - a visually similar but differently-encoded string is NOT identical", () => {
    // Composed é (U+00E9) versus decomposed e + combining acute (U+0065 U+0301).
    const result = assessTemplateCopy({ mappingText: "Café", templateText: "Café", decision: null });
    expect(result.status).toBe("REPLACED");
    expect(result.blocks).toBe(false);
  });

  it("blocks identical non-Latin and right-to-left wording just the same", () => {
    expect(assessTemplateCopy({ mappingText: "מבית DYO App", templateText: "מבית DYO App", decision: null }).blocks).toBe(true);
    expect(assessTemplateCopy({ mappingText: "بيت العلامة", templateText: "بيت العلامة", decision: null }).blocks).toBe(true);
    expect(assessTemplateCopy({ mappingText: "ブランド", templateText: "ブランド", decision: null }).blocks).toBe(true);
  });

  it("blocks identical multiline text, including After Effects' own carriage returns", () => {
    const multiline = "From some of the \rworld's most talented \rcreators ";
    expect(assessTemplateCopy({ mappingText: multiline, templateText: multiline, decision: null }).status).toBe("IDENTICAL");
  });

  it("treats a case-only difference as a trivial variant that stays unresolved", () => {
    const result = assessTemplateCopy({ mappingText: "ASSETS", templateText: "Assets", decision: null });
    expect(result.status).toBe("TRIVIAL_VARIANT");
    expect(result.variantKind).toBe("CASE");
    expect(result.blocks).toBe(true);
    expect(result.reason).toContain("letter case");
  });

  it("treats a whitespace-only difference as a trivial variant that stays unresolved", () => {
    const result = assessTemplateCopy({ mappingText: "  Free!  ", templateText: "Free!", decision: null });
    expect(result.status).toBe("TRIVIAL_VARIANT");
    expect(result.variantKind).toBe("WHITESPACE");
    expect(result.blocks).toBe(true);
  });

  it("treats a line-break-only difference as a whitespace variant", () => {
    const result = assessTemplateCopy({ mappingText: "one two three", templateText: "one\rtwo\rthree", decision: null });
    expect(result.status).toBe("TRIVIAL_VARIANT");
    expect(result.variantKind).toBe("WHITESPACE");
    expect(result.blocks).toBe(true);
  });

  it("treats a combined case-and-whitespace difference as a trivial variant", () => {
    const result = assessTemplateCopy({ mappingText: "free !", templateText: "Free!", decision: null });
    expect(result.status).toBe("TRIVIAL_VARIANT");
    expect(result.variantKind).toBe("CASE_AND_WHITESPACE");
    expect(result.blocks).toBe(true);
  });

  it("blocks when the manifest never captured the template's own text, naming re-inspection", () => {
    const result = assessTemplateCopy({ mappingText: "anything at all", templateText: undefined, decision: null });
    expect(result.status).toBe("TEMPLATE_TEXT_UNKNOWN");
    expect(result.blocks).toBe(true);
    expect(result.reason).toContain("re-run template inspection");
  });

  it("is not applicable when the mapping carries no text, or the placeholder is not a text layer", () => {
    expect(assessTemplateCopy({ mappingText: null, templateText: "Assets", decision: null }).status).toBe("NOT_APPLICABLE");
    expect(assessTemplateCopy({ mappingText: null, templateText: undefined, decision: null }).blocks).toBe(false);
    expect(assessTemplateCopy({ mappingText: "a logo file", templateText: null, decision: null }).status).toBe("NOT_APPLICABLE");
  });

  it("an explicit KEEP_TEMPLATE_TEXT decision about this exact text unblocks identical copy", () => {
    const result = assessTemplateCopy({ mappingText: "Assets", templateText: "Assets", decision: decision({ textAtDecision: "Assets" }) });
    expect(result.status).toBe("IDENTICAL");
    expect(result.decisionState).toBe("CURRENT");
    expect(result.effectiveDecision).toBe("KEEP_TEMPLATE_TEXT");
    expect(result.blocks).toBe(false);
  });

  it("a REPLACE decision does NOT unblock text that is still identical - saying 'replace' is not replacing", () => {
    const result = assessTemplateCopy({
      mappingText: "Assets",
      templateText: "Assets",
      decision: decision({ decision: "REPLACE", textAtDecision: "Assets" })
    });
    expect(result.blocks).toBe(true);
    expect(result.effectiveDecision).toBe("REPLACE");
  });

  it("either explicit decision acknowledges a trivial variant, because the reviewer was shown the difference", () => {
    const keep = assessTemplateCopy({ mappingText: "ASSETS", templateText: "Assets", decision: decision({ textAtDecision: "ASSETS" }) });
    const replace = assessTemplateCopy({
      mappingText: "ASSETS",
      templateText: "Assets",
      decision: decision({ decision: "REPLACE", textAtDecision: "ASSETS" })
    });
    expect(keep.blocks).toBe(false);
    expect(replace.blocks).toBe(false);
  });

  it("a decision made about DIFFERENT text is stale and never carries over", () => {
    const result = assessTemplateCopy({
      mappingText: "Assets",
      templateText: "Assets",
      decision: decision({ textAtDecision: "something the reviewer saw earlier" })
    });
    expect(result.decisionState).toBe("STALE");
    expect(result.effectiveDecision).toBeNull();
    expect(result.blocks).toBe(true);
    expect(result.reason).toContain("made about different text");
  });

  it("an unknown template text blocks even with a keep decision - nothing was verified to keep", () => {
    const result = assessTemplateCopy({ mappingText: "Assets", templateText: undefined, decision: decision({ textAtDecision: "Assets" }) });
    expect(result.blocks).toBe(true);
    expect(result.status).toBe("TEMPLATE_TEXT_UNKNOWN");
  });

  it("empty text is compared like any other: identical to an empty template text, genuinely different from a non-empty one", () => {
    expect(assessTemplateCopy({ mappingText: "", templateText: "", decision: null }).status).toBe("IDENTICAL");
    // Emptying a line is a real change, not a near-miss - whether an empty
    // line is desirable is the ordinary mapping-review question, not this gate's.
    expect(assessTemplateCopy({ mappingText: "", templateText: "Assets", decision: null }).status).toBe("REPLACED");
    // ...but a template line that is itself only whitespace is still a near-miss.
    expect(assessTemplateCopy({ mappingText: "", templateText: "   ", decision: null }).status).toBe("TRIVIAL_VARIANT");
  });
});

describe("templateTextDecisionRecordSchema", () => {
  it("requires who decided, when, and the exact text decided about", () => {
    expect(() => templateTextDecisionRecordSchema.parse({ decision: "KEEP_TEMPLATE_TEXT", decidedBy: "user-1", decidedAt: DECIDED_AT, textAtDecision: "Assets" })).not.toThrow();
    expect(() => templateTextDecisionRecordSchema.parse({ decision: "KEEP_TEMPLATE_TEXT", decidedAt: DECIDED_AT, textAtDecision: "Assets" })).toThrow();
    expect(() => templateTextDecisionRecordSchema.parse({ decision: "KEEP_TEMPLATE_TEXT", decidedBy: "user-1", decidedAt: DECIDED_AT })).toThrow();
  });

  it("rejects any decision value outside the two explicit choices - there is no implicit third state", () => {
    expect(() => templateTextDecisionRecordSchema.parse({ decision: "MAYBE", decidedBy: "u", decidedAt: DECIDED_AT, textAtDecision: "x" })).toThrow();
  });
});
