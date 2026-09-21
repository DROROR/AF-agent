import { describe, expect, it } from "vitest";
import { computeTextVerification } from "@dyo/schemas";
import { buildTemplateManifest, computeInspectionSummary } from "./build-manifest.js";
import type { CompositionFact, LayerFact, ProjectFacts } from "./project-facts.js";

function layer(overrides: Partial<LayerFact>): LayerFact {
  return {
    name: "Layer",
    index: 1,
    layerKind: "Unknown",
    footage: null,
    solidFill: null,
    enabled: null,
    layerPath: [],
    startTimeSeconds: 0,
    durationSeconds: 5,
    ...overrides
  };
}

function composition(overrides: Partial<CompositionFact>): CompositionFact {
  return {
    compositionId: "comp-1",
    aeProjectItemIndex: 1,
    name: "Comp",
    widthPx: 1920,
    heightPx: 1080,
    durationSeconds: 5,
    frameRate: 30,
    isNestedOnlyReferenced: false,
    parentCompositionIds: [],
    layers: [],
    precompChildren: [],
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
    // Required on ProjectFacts: a scan that did not run is an EMPTY map,
    // never an absent field - see ProjectFacts' own doc comment.
    layerFactsByCompositionAndIndex: new Map(),
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

describe("computeInspectionSummary", () => {
  it("derives every count directly from the manifest, including the extra unknownItems count", () => {
    const facts = baseFacts({
      compositions: [
        composition({
          compositionId: "top",
          isNestedOnlyReferenced: false,
          layers: [
            layer({ name: "Editable", index: 1, layerKind: "TextLayer" }),
            layer({ name: "Mystery", index: 2, layerKind: "CameraLayer" })
          ]
        }),
        composition({ compositionId: "nested", isNestedOnlyReferenced: true })
      ]
    });
    const manifest = buildTemplateManifest(facts, fixedNow);
    manifest.unknownItems.push({ context: "(project)", reason: "extra note appended after building" });

    const summary = computeInspectionSummary(manifest);
    expect(summary.compositionCount).toBe(2);
    expect(summary.candidateSceneCount).toBe(1);
    expect(summary.editablePlaceholderCount).toBe(1);
    expect(summary.nestedCompositionCount).toBe(1);
    expect(summary.unknownItemCount).toBe(2);
  });
});

describe("buildTemplateManifest - template text capture (leftover-template-copy gate)", () => {
  it("carries a text layer's own captured text onto its placeholder, exactly", () => {
    const text = "מבית DYO App\rsecond line";
    const manifest = buildTemplateManifest(
      baseFacts({ compositions: [composition({ layers: [layer({ name: "Headline", index: 1, layerKind: "TextLayer", sourceText: text })] })] }),
      fixedNow
    );
    expect(manifest.scenes[0]?.placeholders[0]?.originalText).toBe(text);
  });

  it("records null for a layer that genuinely has no text", () => {
    const manifest = buildTemplateManifest(
      baseFacts({
        compositions: [composition({ layers: [layer({ name: "Card", index: 1, layerKind: "AVLayer", footage: { hasVideo: false, hasAudio: false, isStill: true, isMissing: false, widthPx: 10, heightPx: 10 }, sourceText: null })] })]
      }),
      fixedNow
    );
    expect(manifest.scenes[0]?.placeholders[0]?.originalText).toBeNull();
  });

  it("leaves the field ABSENT when the scan never reported template text - never defaulted to null, so 'never captured' stays distinguishable from 'no text'", () => {
    const manifest = buildTemplateManifest(
      baseFacts({ compositions: [composition({ layers: [layer({ name: "Headline", index: 1, layerKind: "TextLayer" })] })] }),
      fixedNow
    );
    const placeholder = manifest.scenes[0]?.placeholders[0];
    expect(placeholder && "originalText" in placeholder).toBe(false);
  });

  it("stores a long text as a labelled EXCERPT plus digests of the complete text - never as the original, and never as unverifiable", () => {
    const completeText = `${"a".repeat(10_000)} and the real ending`;
    const manifest = buildTemplateManifest(
      baseFacts({
        compositions: [
          composition({
            layers: [
              layer({
                name: "Headline",
                index: 1,
                layerKind: "TextLayer",
                sourceText: completeText.slice(0, 10_000),
                sourceTextTruncated: true,
                sourceTextCodeUnitLength: completeText.length,
                sourceTextVerification: computeTextVerification(completeText)
              })
            ]
          })
        ]
      }),
      fixedNow
    );
    const placeholder = manifest.scenes[0]?.placeholders[0];
    // The complete text is NOT stored, and the excerpt is kept under its own key.
    expect(placeholder && "originalText" in placeholder).toBe(false);
    expect(placeholder?.originalTextTruncated).toBe(true);
    expect(placeholder?.originalTextPreview).toBe(completeText.slice(0, 10_000));
    // ...but the digests describe the COMPLETE text, so it stays verifiable.
    expect(placeholder?.originalTextVerification).toMatchObject(computeTextVerification(completeText));
  });

  it("ties captured text evidence to the immutable source fingerprint it was read from", () => {
    const manifest = buildTemplateManifest(
      baseFacts({
        projectSha256: "f".repeat(64),
        compositions: [composition({ layers: [layer({ name: "Headline", index: 1, layerKind: "TextLayer", sourceText: "short", sourceTextVerification: computeTextVerification("short") })] })]
      }),
      fixedNow
    );
    expect(manifest.scenes[0]?.placeholders[0]?.originalTextVerification?.sourceProjectSha256).toBe("f".repeat(64));
  });

  it("leaves a truncated capture without digests genuinely unverifiable rather than guessing", () => {
    const manifest = buildTemplateManifest(
      baseFacts({
        compositions: [composition({ layers: [layer({ name: "Headline", index: 1, layerKind: "TextLayer", sourceText: "a very long line that was cut", sourceTextTruncated: true })] })]
      }),
      fixedNow
    );
    const placeholder = manifest.scenes[0]?.placeholders[0];
    expect(placeholder && "originalText" in placeholder).toBe(false);
    expect(placeholder?.originalTextTruncated).toBe(true);
  });
});

/**
 * STAGE 4: every slot a client asset can land in carries a structural verdict.
 * These use synthetic shapes only - a layer cut by a rendered matte, a plain
 * un-matted image, a text line - never a real template's hierarchy.
 */
describe("buildTemplateManifest - slot semantics", () => {
  const scan = (detail: Record<string, unknown>, footage?: Record<string, unknown>) => ({
    kind: "AVLayer",
    footage: footage ?? null,
    detail
  });

  it("gives a top-level image layer a real verdict, fingerprints and a visible window", () => {
    const scene = composition({
      compositionId: "comp-1",
      layers: [layer({ index: 1, name: "an image", layerKind: "AVLayer", footage: { hasVideo: false, hasAudio: false, isStill: true, isMissing: false, widthPx: 1600, heightPx: 900 }, enabled: true })]
    });
    const manifest = buildTemplateManifest(
      baseFacts({
        compositions: [scene],
        layerFactsByCompositionAndIndex: new Map([["comp-1:1", scan({ hasTrackMatte: false, threeDLayer: false, parentLayerIndex: null, inPointSeconds: 0, outPointSeconds: 4 })]])
      }),
      fixedNow
    );

    const placeholder = manifest.scenes[0]!.placeholders[0]!;
    expect(placeholder.placeholderType).toBe("image");
    expect(placeholder.slotSemantics?.classification).toBe("flat_card");
    expect(placeholder.slotSemantics?.requiresHumanDecision).toBe(false);
    expect(placeholder.slotFacts?.visibleWindowSeconds).toEqual({ startSeconds: 0, endSeconds: 4 });
    expect(placeholder.slotFingerprint?.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(placeholder.slotMutationFingerprint?.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("classifies an image layer cut by a rendered matte and animated in 3D as a device screen", () => {
    const scene = composition({
      compositionId: "comp-1",
      layers: [
        layer({ index: 1, name: "screen", layerKind: "AVLayer", footage: { hasVideo: false, hasAudio: false, isStill: true, isMissing: false, widthPx: 1080, heightPx: 2160 }, enabled: true }),
        layer({ index: 2, name: "hardware", layerKind: "AVLayer", footage: { hasVideo: true, hasAudio: false, isStill: false, isMissing: false, widthPx: 1080, heightPx: 2160 }, enabled: true })
      ]
    });
    const manifest = buildTemplateManifest(
      baseFacts({
        compositions: [scene],
        layerFactsByCompositionAndIndex: new Map([
          ["comp-1:1", scan({ hasTrackMatte: true, trackMatteLayerIndex: 2, threeDLayer: true, parentLayerIndex: 3, inPointSeconds: 0, outPointSeconds: 5 })],
          ["comp-1:2", scan({ hasTrackMatte: true, trackMatteLayerIndex: 4 }, { hasVideo: true, isStill: false, isSolid: false })],
          ["comp-1:3", scan({ hasTransformKeyframes: true })],
          ["comp-1:4", scan({}, { hasVideo: true, isStill: false, isSolid: false })]
        ])
      }),
      fixedNow
    );

    const screen = manifest.scenes[0]!.placeholders.find((placeholder) => placeholder.layerIndex === 1)!;
    expect(screen.slotSemantics?.classification).toBe("device_screen");
    expect(screen.slotFacts?.hosts[0]?.matteSource).toBe("RENDERED_FOOTAGE");
  });

  it("gives a text placeholder no slot verdict at all - a text line is not a window into anything", () => {
    const scene = composition({
      compositionId: "comp-1",
      layers: [layer({ index: 1, name: "a headline", layerKind: "TextLayer", sourceText: "wording", enabled: true })]
    });
    const manifest = buildTemplateManifest(baseFacts({ compositions: [scene], layerFactsByCompositionAndIndex: new Map() }), fixedNow);
    const placeholder = manifest.scenes[0]!.placeholders[0]!;
    expect(placeholder.placeholderType).toBe("text");
    expect(placeholder.slotFacts).toBeUndefined();
    expect(placeholder.slotSemantics).toBeUndefined();
  });

  it("lowers confidence to a human decision when this worker build captured no scan at all", () => {
    const scene = composition({
      compositionId: "comp-1",
      layers: [layer({ index: 1, name: "an image", layerKind: "AVLayer", footage: { hasVideo: false, hasAudio: false, isStill: true, isMissing: false, widthPx: 800, heightPx: 800 }, enabled: true })]
    });
    const manifest = buildTemplateManifest(baseFacts({ compositions: [scene] }), fixedNow);
    const placeholder = manifest.scenes[0]!.placeholders[0]!;
    expect(placeholder.slotSemantics?.requiresHumanDecision).toBe(true);
    expect(placeholder.slotFacts?.hosts[0]?.matteSource).toBe("UNKNOWN");
  });
});
