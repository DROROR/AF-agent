import { describe, expect, it } from "vitest";
import type { PlaceholderMapping, ScenePlanEntry } from "@dyo/schemas";
import { computeSceneUnresolvedReasons, isMappingResolved, mappingHasContentDecision } from "../compute-scene-unresolved-reasons.js";

const NOW = "2026-08-26T00:00:00.000Z";

function mapping(overrides: Partial<PlaceholderMapping> = {}): PlaceholderMapping {
  return {
    id: "mapping-1",
    manifestPlaceholderId: "ph-1",
    placeholderName: "Headline",
    placeholderClassification: { value: "text", source: "MANIFEST", evidence: ["manifest"] },
    selectedAssetId: null,
    selectedAssetType: null,
    text: null,
    assetTimestamp: null,
    colorHex: null,
    layerVisible: null,
    freezeAtSeconds: null,
    layerDurationSeconds: null,
    mappingSource: "MANIFEST",
    confidence: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function scene(overrides: Partial<ScenePlanEntry> = {}): ScenePlanEntry {
  return {
    id: "scene-1",
    manifestCompositionId: "comp-1",
    compositionName: "Scene 01",
    use: true,
    sourcePosition: 0,
    finalOrder: 0,
    finalDuration: null,
    approvalState: "UNREVIEWED",
    instructions: null,
    notes: null,
    unresolvedReasons: ["no confident structural classification for any detected placeholder yet"],
    evidence: [],
    mappings: [mapping()],
    reelsLayout: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

describe("mappingHasContentDecision", () => {
  it("is false with no asset/text/color", () => {
    expect(mappingHasContentDecision(mapping())).toBe(false);
  });
  it("is true once a real asset is selected", () => {
    expect(mappingHasContentDecision(mapping({ selectedAssetId: "asset-1" }))).toBe(true);
  });
  it("is true once real text is set", () => {
    expect(mappingHasContentDecision(mapping({ text: "Hello" }))).toBe(true);
  });
  it("is false for whitespace-only text - never a fake decision", () => {
    expect(mappingHasContentDecision(mapping({ text: "   " }))).toBe(false);
  });
  it("is true once a brand color is set", () => {
    expect(mappingHasContentDecision(mapping({ colorHex: "#FF0000" }))).toBe(true);
  });
});

describe("isMappingResolved", () => {
  it("a genuine content target (text-classified) with no decision is NOT resolved - a real human decision is still required (section 2: never mark genuinely missing content decisions resolved)", () => {
    const s = scene();
    expect(isMappingResolved(s.mappings[0]!, s.instructions)).toBe(false);
  });

  it("a content mapping IS resolved once it has a real accepted asset/text", () => {
    const s = scene({ mappings: [mapping({ text: "Real headline" })] });
    expect(isMappingResolved(s.mappings[0]!, s.instructions)).toBe(true);
  });

  it("a structural no-op (e.g. CONTROL layer, never classified) counts as resolved with zero content, regardless of any suggestion accept/reject history", () => {
    const structural = mapping({ placeholderName: "CONTROL", placeholderClassification: { value: null, source: "MANIFEST", evidence: [] } });
    const s = scene({ mappings: [structural] });
    expect(isMappingResolved(structural, s.instructions)).toBe(true);
  });

  it("rejecting a bad replacement for a structural target (leaving it exactly as-is) still resolves it - same structural exemption applies with or without any suggestion decision", () => {
    const structural = mapping({ placeholderName: "Phone_mask.png", placeholderClassification: { value: null, source: "MANIFEST", evidence: [] } });
    const s = scene({ mappings: [structural] });
    expect(isMappingResolved(structural, s.instructions)).toBe(true);
  });

  it("an explicit 'keep unchanged' scene instruction resolves an otherwise-ambiguous (non-content, non-structural-by-name) mapping", () => {
    const ambiguous = mapping({ placeholderName: "Layer 7", placeholderClassification: { value: null, source: "MANIFEST", evidence: [] } });
    const s = scene({ mappings: [ambiguous], instructions: "Keep this unchanged." });
    expect(isMappingResolved(ambiguous, s.instructions)).toBe(true);
  });

  it("a 'keep unchanged' scene instruction never resolves a real content target (Phone_screen) just because a sibling or the scene note says so", () => {
    const contentTarget = mapping({ placeholderName: "Phone_screen", placeholderClassification: { value: "phone_screen", source: "MANIFEST", evidence: [] } });
    const s = scene({ mappings: [contentTarget], instructions: "Keep scene wrapper animation unchanged." });
    expect(isMappingResolved(contentTarget, s.instructions)).toBe(false);
  });
});

describe("computeSceneUnresolvedReasons - the real propagation fix", () => {
  it("real production bug reproduced: the OLD build-time check ('no confident classification for any placeholder') stays stale forever - this NEW computation is instead based on live mapping-decision state", () => {
    // Placeholder never gets a confident manifest classification (very
    // common in real data - test22's own real placeholders are almost
    // all classification: null) but DOES have a real accepted decision.
    const resolvedButUnclassified = mapping({
      placeholderClassification: { value: null, source: "MANIFEST", evidence: ["no confident structural signal matched a known placeholder type"] },
      text: "Your all-in-one app"
    });
    const s = scene({ mappings: [resolvedButUnclassified] });
    expect(computeSceneUnresolvedReasons(s)).toEqual([]);
  });

  it("a scene with a genuinely undecided content mapping remains unresolved", () => {
    const s = scene();
    expect(computeSceneUnresolvedReasons(s)).toHaveLength(1);
    expect(computeSceneUnresolvedReasons(s)[0]).toContain("1 placeholder(s)");
  });

  it("a scene where every mapping is resolved (mix of real decisions and structural exemptions) has zero unresolved reasons", () => {
    const decided = mapping({ id: "m1", text: "Real text" });
    const structural = mapping({ id: "m2", placeholderName: "Shape Layer 1", placeholderClassification: { value: null, source: "MANIFEST", evidence: [] } });
    const s = scene({ mappings: [decided, structural] });
    expect(computeSceneUnresolvedReasons(s)).toEqual([]);
  });

  it("counts exactly the genuinely-undecided mappings, never every mapping in the scene", () => {
    const decided = mapping({ id: "m1", text: "Real text" });
    const undecided = mapping({ id: "m2", placeholderName: "Body Text 2" });
    const s = scene({ mappings: [decided, undecided] });
    expect(computeSceneUnresolvedReasons(s)[0]).toContain("1 placeholder(s)");
  });

  it("a composition-level-only scene (zero mappings) preserves its build-time structural reason unchanged - no mapping decision can ever resolve it", () => {
    const s = scene({ mappings: [], unresolvedReasons: ["no placeholder detected in this composition"] });
    expect(computeSceneUnresolvedReasons(s)).toEqual(["no placeholder detected in this composition"]);
  });
});
