import { describe, expect, it } from "vitest";
import { buildTemplateManifest } from "./build-manifest.js";
import type { CompositionFact, LayerFact, ProjectFacts } from "./project-facts.js";

function layer(overrides: Partial<LayerFact>): LayerFact {
  return {
    name: "Layer",
    index: 1,
    layerKind: "Unknown",
    footage: null,
    solidFill: null,
    layerPath: [],
    startTimeSeconds: 0,
    durationSeconds: 5,
    ...overrides
  };
}

function composition(overrides: Partial<CompositionFact>): CompositionFact {
  return {
    compositionId: "comp-1",
    name: "Comp",
    widthPx: 1920,
    heightPx: 1080,
    durationSeconds: 5,
    frameRate: 30,
    isNestedOnlyReferenced: false,
    parentCompositionIds: [],
    layers: [],
    ...overrides
  };
}

function baseFacts(overrides: Partial<ProjectFacts> = {}): ProjectFacts {
  return {
    templateId: "tmpl-1",
    templateName: "Test Template",
    aeVersion: "26.3x87",
    sourceProjectPath: "/copies/test-copy.aep",
    sourceProjectName: "test.aep",
    projectSha256: "a".repeat(64),
    compositions: [],
    requiredFonts: [],
    footageReferenced: [],
    missingFootage: [],
    pluginReferences: [],
    ...overrides
  };
}

const fixedNow = () => new Date("2026-08-23T00:00:00Z");

describe("buildTemplateManifest", () => {
  it("preserves original composition/scene order exactly, never re-sorting", () => {
    const facts = baseFacts({
      compositions: [
        composition({ compositionId: "comp-c", name: "C" }),
        composition({ compositionId: "comp-a", name: "A" }),
        composition({ compositionId: "comp-b", name: "B" })
      ]
    });
    const manifest = buildTemplateManifest(facts, fixedNow);
    expect(manifest.scenes.map((s) => s.compositionId)).toEqual(["comp-c", "comp-a", "comp-b"]);
    expect(manifest.scenes.map((s) => s.originalOrderIndex)).toEqual([0, 1, 2]);
  });

  it("excludes nested-only compositions from scene candidates, but still lists them under compositions", () => {
    const facts = baseFacts({
      compositions: [
        composition({ compositionId: "top", isNestedOnlyReferenced: false }),
        composition({ compositionId: "nested", isNestedOnlyReferenced: true, parentCompositionIds: ["top"] })
      ]
    });
    const manifest = buildTemplateManifest(facts, fixedNow);
    expect(manifest.compositions).toHaveLength(2);
    expect(manifest.scenes).toHaveLength(1);
    expect(manifest.scenes[0]!.compositionId).toBe("top");
  });

  it("gives two layers with the same name but different index distinct placeholder IDs - they do not collapse into one", () => {
    const facts = baseFacts({
      compositions: [
        composition({
          layers: [
            layer({ name: "Duplicate", index: 1, layerKind: "TextLayer" }),
            layer({ name: "Duplicate", index: 2, layerKind: "TextLayer" })
          ]
        })
      ]
    });
    const manifest = buildTemplateManifest(facts, fixedNow);
    const placeholders = manifest.scenes[0]!.placeholders;
    expect(placeholders).toHaveLength(2);
    expect(placeholders[0]!.placeholderId).not.toBe(placeholders[1]!.placeholderId);
    expect(placeholders.map((p) => p.layerName)).toEqual(["Duplicate", "Duplicate"]);
    expect(placeholders.map((p) => p.layerIndex)).toEqual([1, 2]);
  });

  it("produces the same placeholder/scene IDs across two runs on the same structure - stable IDs", () => {
    const facts = baseFacts({
      compositions: [composition({ layers: [layer({ name: "A", index: 1, layerKind: "TextLayer" })] })]
    });
    const first = buildTemplateManifest(facts, fixedNow);
    const second = buildTemplateManifest(facts, fixedNow);
    expect(first.scenes[0]!.sceneId).toBe(second.scenes[0]!.sceneId);
    expect(first.scenes[0]!.placeholders[0]!.placeholderId).toBe(second.scenes[0]!.placeholders[0]!.placeholderId);
  });

  it("keeps placeholder IDs stable across a layer rename - only structural position feeds the ID, not the name", () => {
    const originalName = buildTemplateManifest(
      baseFacts({ compositions: [composition({ layers: [layer({ name: "Original Name", index: 1, layerKind: "TextLayer" })] })] }),
      fixedNow
    );
    const renamed = buildTemplateManifest(
      baseFacts({ compositions: [composition({ layers: [layer({ name: "Renamed", index: 1, layerKind: "TextLayer" })] })] }),
      fixedNow
    );
    expect(originalName.scenes[0]!.placeholders[0]!.placeholderId).toBe(renamed.scenes[0]!.placeholders[0]!.placeholderId);
  });

  it("collects an unknownItems entry for every placeholder that classifies as unknown", () => {
    const facts = baseFacts({
      compositions: [
        composition({
          name: "Weird Comp",
          layers: [layer({ name: "Mystery Layer", index: 1, layerKind: "CameraLayer" })]
        })
      ]
    });
    const manifest = buildTemplateManifest(facts, fixedNow);
    expect(manifest.unknownItems).toHaveLength(1);
    expect(manifest.unknownItems[0]!.context).toContain("Weird Comp");
    expect(manifest.unknownItems[0]!.context).toContain("Mystery Layer");
  });

  it("never fills in displayName/displayLabel - those stay null from automated inspection", () => {
    const facts = baseFacts({
      compositions: [composition({ layers: [layer({ name: "Anything", index: 1, layerKind: "TextLayer" })] })]
    });
    const manifest = buildTemplateManifest(facts, fixedNow);
    expect(manifest.scenes[0]!.displayName).toBeNull();
    expect(manifest.scenes[0]!.placeholders[0]!.displayLabel).toBeNull();
  });

  it("carries preflight facts (fonts/footage/missing footage/plugins) through unchanged", () => {
    const facts = baseFacts({
      requiredFonts: ["Heebo"],
      footageReferenced: ["logo.png"],
      missingFootage: [{ name: "hero.mp4", expectedPath: "(footage)/hero.mp4" }],
      pluginReferences: ["Element 3D"]
    });
    const manifest = buildTemplateManifest(facts, fixedNow);
    expect(manifest.preflight.requiredFonts).toEqual(["Heebo"]);
    expect(manifest.preflight.footageReferenced).toEqual(["logo.png"]);
    expect(manifest.preflight.missingFootage).toEqual([{ name: "hero.mp4", expectedPath: "(footage)/hero.mp4" }]);
    expect(manifest.preflight.pluginReferences).toEqual(["Element 3D"]);
  });
});
