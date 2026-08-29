import { describe, expect, it } from "vitest";
import type { ExecutionPlan, PlaceholderMapping, ScenePlanEntry } from "@dyo/schemas";
import { validateBrandRules, type BrandRulesConfig } from "../validate-brand-rules.js";

const NOW = new Date("2026-08-29T00:00:00.000Z").toISOString();

function mapping(overrides: Partial<PlaceholderMapping> = {}): PlaceholderMapping {
  return {
    id: "mapping-1",
    manifestPlaceholderId: "ph-1",
    placeholderName: "Layer",
    placeholderClassification: { value: "text", source: "MANIFEST", evidence: [] },
    selectedAssetId: null,
    selectedAssetType: null,
    text: null,
    assetTimestamp: null,
    colorHex: null,
    layerVisible: null,
    freezeAtSeconds: null,
    layerDurationSeconds: null,
    mappingSource: "HUMAN",
    confidence: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function scene(overrides: Partial<ScenePlanEntry> = {}, mappings: PlaceholderMapping[] = []): ScenePlanEntry {
  return {
    id: "scene-1",
    manifestCompositionId: "comp-1",
    compositionName: "Scene 01",
    use: true,
    sourcePosition: 0,
    finalOrder: 0,
    finalDuration: null,
    approvalState: "APPROVED",
    instructions: null,
    notes: null,
    unresolvedReasons: [],
    evidence: [],
    mappings,
    reelsLayout: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function plan(scenePlans: ScenePlanEntry[]): Pick<ExecutionPlan, "scenePlans"> {
  return { scenePlans };
}

const CONFIG: BrandRulesConfig = {
  requireLogoPresence: true,
  requiredHebrewText: "מבית DYO App",
  dyoBlueHex: null,
  rtlPreservedByConstruction: true
};

describe("validateBrandRules", () => {
  it("fails closed when neither a logo mapping nor the required Hebrew text is present anywhere in the active scenes", () => {
    const result = validateBrandRules(plan([scene({}, [mapping({ text: "Some other headline" })])]), CONFIG);
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toEqual(["LOGO_PRESENCE", "REQUIRED_HEBREW_TEXT"]);
  });

  it("passes once an active scene has a selected logo asset AND the required Hebrew text", () => {
    const result = validateBrandRules(
      plan([
        scene({}, [
          mapping({ selectedAssetType: "logo", selectedAssetId: "asset-logo" }),
          mapping({ id: "mapping-2", text: "מבית DYO App" })
        ])
      ]),
      CONFIG
    );
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("ignores a scene marked use: false - required brand elements from an excluded scene never satisfy the rule", () => {
    const result = validateBrandRules(
      plan([
        scene({ use: false }, [mapping({ selectedAssetType: "logo", selectedAssetId: "asset-logo" }), mapping({ id: "m2", text: "מבית DYO App" })]),
        scene({ id: "scene-2" }, [mapping({ text: "no branding here" })])
      ]),
      CONFIG
    );
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toEqual(["LOGO_PRESENCE", "REQUIRED_HEBREW_TEXT"]);
  });

  it("warns (never blocks) when dyoBlueHex is unconfigured, even with active color-classified mappings", () => {
    const result = validateBrandRules(
      plan([
        scene({}, [
          mapping({ selectedAssetType: "logo", selectedAssetId: "asset-logo" }),
          mapping({ id: "m2", text: "מבית DYO App" }),
          mapping({ id: "m3", placeholderClassification: { value: "color", source: "HUMAN", evidence: [] }, colorHex: "#123456" })
        ])
      ]),
      CONFIG
    );
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      {
        rule: "DYO_BLUE_UNCONFIGURED",
        message:
          "dyo-brand-rules.yaml's dyoBlueHex is not yet configured, so the official-DYO-blue rule is NOT being enforced for this approval - set the real hex value once the client supplies it."
      }
    ]);
  });

  it("once configured, hard-blocks approval if an active color-classified mapping uses the wrong hex", () => {
    const configuredCanonicalBlue: BrandRulesConfig = { ...CONFIG, dyoBlueHex: "#0057FF" };
    const result = validateBrandRules(
      plan([
        scene({}, [
          mapping({ selectedAssetType: "logo", selectedAssetId: "asset-logo" }),
          mapping({ id: "m2", text: "מבית DYO App" }),
          mapping({ id: "m3", placeholderClassification: { value: "color", source: "HUMAN", evidence: [] }, colorHex: "#123456" })
        ])
      ]),
      configuredCanonicalBlue
    );
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toEqual(["DYO_BLUE_USAGE"]);
  });

  it("once configured, passes when an active color-classified mapping matches the canonical hex exactly", () => {
    const configuredCanonicalBlue: BrandRulesConfig = { ...CONFIG, dyoBlueHex: "#0057FF" };
    const result = validateBrandRules(
      plan([
        scene({}, [
          mapping({ selectedAssetType: "logo", selectedAssetId: "asset-logo" }),
          mapping({ id: "m2", text: "מבית DYO App" }),
          mapping({ id: "m3", placeholderClassification: { value: "color", source: "HUMAN", evidence: [] }, colorHex: "#0057FF" })
        ])
      ]),
      configuredCanonicalBlue
    );
    expect(result.ok).toBe(true);
  });

  it("once configured, does not block a plan with no color-classified mapping at all ('when applicable')", () => {
    const configuredCanonicalBlue: BrandRulesConfig = { ...CONFIG, dyoBlueHex: "#0057FF" };
    const result = validateBrandRules(
      plan([scene({}, [mapping({ selectedAssetType: "logo", selectedAssetId: "asset-logo" }), mapping({ id: "m2", text: "מבית DYO App" })])]),
      configuredCanonicalBlue
    );
    expect(result.ok).toBe(true);
  });
});
