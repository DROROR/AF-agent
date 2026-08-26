import { describe, expect, it } from "vitest";
import { buildProjectFacts } from "./build-project-facts.js";
import type { CompositionDetail, CompositionSummary } from "./parse-mcp-shapes.js";

const summaryA: CompositionSummary = {
  index: 3,
  name: "Comp A",
  widthPx: 1920,
  heightPx: 1080,
  frameRate: 30,
  durationSeconds: 5,
  numLayers: 2
};

const summaryB: CompositionSummary = {
  index: 7,
  name: "Comp B",
  widthPx: 1080,
  heightPx: 1920,
  frameRate: 30,
  durationSeconds: 10,
  numLayers: 0
};

const detailA: CompositionDetail = {
  compId: 42,
  name: "Comp A",
  widthPx: 1920,
  heightPx: 1080,
  frameRate: 30,
  durationSeconds: 5,
  numLayers: 2,
  layers: [
    { index: 1, name: "Text Layer", inPointSeconds: 0, outPointSeconds: 5, nullLayer: false },
    { index: 2, name: "Null Anchor", inPointSeconds: 0, outPointSeconds: 5, nullLayer: true }
  ]
};

describe("buildProjectFacts", () => {
  it("uses comp.id (more stable than project-item index) for compositionId when a detail was fetched", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA],
      details: [detailA]
    });
    expect(facts.compositions[0]?.compositionId).toBe("comp-42");
  });

  it("falls back to the project-item index when the detail fetch failed for that composition", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: null,
      discovered: [summaryB],
      details: [null]
    });
    expect(facts.compositions[0]?.compositionId).toBe("idx-7");
    // No layer facts at all when detail is unavailable - never fabricated.
    expect(facts.compositions[0]?.layers).toEqual([]);
  });

  it("excludes null-object layers from the composition's layers (excluded from placeholder candidates)", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA],
      details: [detailA]
    });
    const layers = facts.compositions[0]?.layers ?? [];
    expect(layers).toHaveLength(1);
    expect(layers[0]?.name).toBe("Text Layer");
  });

  it("always records layerKind as Unknown - the confirmed ae_get_composition shape has no type discriminator, and this never guesses one", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA],
      details: [detailA]
    });
    expect(facts.compositions[0]?.layers[0]?.layerKind).toBe("Unknown");
    expect(facts.compositions[0]?.layers[0]?.footage).toBeNull();
    expect(facts.compositions[0]?.layers[0]?.solidFill).toBeNull();
  });

  it("computes layer duration from outPoint - inPoint", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA],
      details: [detailA]
    });
    expect(facts.compositions[0]?.layers[0]?.startTimeSeconds).toBe(0);
    expect(facts.compositions[0]?.layers[0]?.durationSeconds).toBe(5);
  });

  it("defaults isNestedOnlyReferenced to false and parentCompositionIds to [] - genuinely unconfirmable from this tool set, never guessed from naming", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA],
      details: [detailA]
    });
    expect(facts.compositions[0]?.isNestedOnlyReferenced).toBe(false);
    expect(facts.compositions[0]?.parentCompositionIds).toEqual([]);
  });

  it("preserves discovery order across multiple compositions", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryB, summaryA],
      details: [null, detailA]
    });
    expect(facts.compositions.map((c) => c.name)).toEqual(["Comp B", "Comp A"]);
  });

  it("leaves fonts/footage/missingFootage/pluginReferences honestly empty - not determinable from this tool set", () => {
    const facts = buildProjectFacts({
      templateId: "tmpl-1",
      sourceProjectPath: "/copies/test.aep",
      sourceProjectName: "test.aep",
      projectSha256: "a".repeat(64),
      aeVersion: "26.3x87",
      discovered: [summaryA],
      details: [detailA]
    });
    expect(facts.requiredFonts).toEqual([]);
    expect(facts.footageReferenced).toEqual([]);
    expect(facts.missingFootage).toEqual([]);
    expect(facts.pluginReferences).toEqual([]);
  });
});
