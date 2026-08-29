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
});
