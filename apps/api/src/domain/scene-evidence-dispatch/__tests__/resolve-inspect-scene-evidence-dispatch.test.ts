import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type PlaceholderMapping, type ScenePlanEntry, type TemplateManifest } from "@dyo/schemas";
import {
  resolveInspectSceneEvidenceDispatch,
  type InspectSceneEvidenceDispatchPlanSnapshot
} from "../resolve-inspect-scene-evidence-dispatch.js";

const SHA = "a".repeat(64);
const NOW_ISO = "2026-01-01T00:00:00.000Z";

function validManifest(overrides: Partial<TemplateManifest> = {}): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "tmpl-1",
    templateName: "tmpl-1",
    sourceProject: { path: "C:\\vidio agent\\White App Promo (converted).aep", name: "White App Promo (converted).aep", sha256: SHA },
    afterEffects: { version: "26.3x87" },
    generatedAt: NOW_ISO,
    compositions: [
      { compositionId: "comp-1", aeProjectItemIndex: 5, name: "Scene 01", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] }
    ],
    scenes: [
      {
        sceneId: "scene-a",
        displayName: null,
        compositionId: "comp-1",
        originalOrderIndex: 0,
        startTimeSeconds: 0,
        durationSeconds: 5,
        placeholders: [
          {
            placeholderId: "ph-1",
            displayLabel: null,
            compositionId: "comp-1",
            layerName: "Headline",
            layerIndex: 3,
            layerPath: [],
            placeholderType: "text",
            editable: true,
            sourceType: "TextLayer",
            dimensions: null,
            startTimeSeconds: 0,
            durationSeconds: 5,
            evidence: { source: "read_directly", reason: "confirmed via ae_get_composition" }
          },
          {
            placeholderId: "ph-2",
            displayLabel: null,
            compositionId: "comp-1",
            layerName: "Photo",
            layerIndex: 1,
            layerPath: [],
            placeholderType: "image",
            editable: true,
            sourceType: "AVLayer",
            dimensions: null,
            startTimeSeconds: 0,
            durationSeconds: 5,
            evidence: { source: "read_directly", reason: "confirmed via ae_get_composition" }
          }
        ]
      }
    ],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: [],
    ...overrides
  };
}

function scenePlan(overrides: Partial<ScenePlanEntry> = {}): ScenePlanEntry {
  return {
    id: "scene-1",
    manifestCompositionId: "comp-1",
    compositionName: "Scene 01",
    use: true,
    sourcePosition: 0,
    finalOrder: null,
    finalDuration: null,
    approvalState: "UNREVIEWED",
    instructions: null,
    notes: null,
    unresolvedReasons: [],
    evidence: [],
    mappings: [],
    reelsLayout: null,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...overrides
  };
}

function validPlan(overrides: Partial<InspectSceneEvidenceDispatchPlanSnapshot> = {}): InspectSceneEvidenceDispatchPlanSnapshot {
  return { sourceProjectSha256: SHA, scenePlans: [scenePlan()], ...overrides };
}

describe("resolveInspectSceneEvidenceDispatch", () => {
  it("resolves the real worker payload entirely from trusted state - sourceProjectPath, layerIndices, and aeProjectItemIndex are never the caller's own", () => {
    const result = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "scene-1",
      currentPlan: validPlan(),
      currentProjectManifest: validManifest()
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual({
      sourceProjectPath: "C:\\vidio agent\\White App Promo (converted).aep",
      sourceProjectSha256: SHA,
      manifestCompositionId: "comp-1",
      aeProjectItemIndex: 5,
      compositionName: "Scene 01",
      layerIndices: [1, 3],
      previewTimestampSeconds: 0
    });
  });

  it("live-QA generic AE layer-discovery capability: omits discoverLayerDetails from the payload entirely when not requested - existing callers see byte-identical behavior", () => {
    const result = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "scene-1",
      currentPlan: validPlan(),
      currentProjectManifest: validManifest()
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.prototype.hasOwnProperty.call(result.payload, "discoverLayerDetails")).toBe(false);
  });

  it("live-QA generic AE layer-discovery capability: forwards discoverLayerDetails: true into the resolved payload when requested - still fully generic, no composition/template-specific hardcoding involved in resolving it", () => {
    const result = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "scene-1",
      currentPlan: validPlan(),
      currentProjectManifest: validManifest(),
      discoverLayerDetails: true
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.discoverLayerDetails).toBe(true);
  });

  it("live-QA generic AE layer-discovery capability: false is treated the same as omitted - never forwarded as an explicit false", () => {
    const result = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "scene-1",
      currentPlan: validPlan(),
      currentProjectManifest: validManifest(),
      discoverLayerDetails: false
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.prototype.hasOwnProperty.call(result.payload, "discoverLayerDetails")).toBe(false);
  });

  it("fails closed when no execution plan exists yet", () => {
    const result = resolveInspectSceneEvidenceDispatch({ scenePlanId: "scene-1", currentPlan: null, currentProjectManifest: validManifest() });
    expect(result.ok).toBe(false);
  });

  it("fails closed when the project manifest is unavailable", () => {
    const result = resolveInspectSceneEvidenceDispatch({ scenePlanId: "scene-1", currentPlan: validPlan(), currentProjectManifest: null });
    expect(result.ok).toBe(false);
  });

  it("fails closed when the manifest's current sha256 no longer matches the plan's bound sha256 - never inspects a source that may have changed", () => {
    const result = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "scene-1",
      currentPlan: validPlan({ sourceProjectSha256: "b".repeat(64) }),
      currentProjectManifest: validManifest()
    });
    expect(result.ok).toBe(false);
  });

  it("fails closed for an unknown scenePlanId - never guesses which scene to inspect", () => {
    const result = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "does-not-exist",
      currentPlan: validPlan(),
      currentProjectManifest: validManifest()
    });
    expect(result.ok).toBe(false);
  });

  it("fails closed when the scene's manifestCompositionId no longer matches any real composition", () => {
    const result = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "scene-1",
      currentPlan: validPlan({ scenePlans: [scenePlan({ manifestCompositionId: "comp-gone" })] }),
      currentProjectManifest: validManifest()
    });
    expect(result.ok).toBe(false);
  });

  it("live QA Blocker 2 fix: a composition with zero placeholders still resolves ok - layerIndices: [], with a real frame capture still requested and exact composition identity still included", () => {
    const result = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "scene-1",
      currentPlan: validPlan(),
      currentProjectManifest: validManifest({
        scenes: [{ sceneId: "scene-a", displayName: null, compositionId: "comp-1", originalOrderIndex: 0, startTimeSeconds: 0, durationSeconds: 5, placeholders: [] }]
      })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual({
      sourceProjectPath: "C:\\vidio agent\\White App Promo (converted).aep",
      sourceProjectSha256: SHA,
      manifestCompositionId: "comp-1",
      aeProjectItemIndex: 5,
      compositionName: "Scene 01",
      layerIndices: [],
      previewTimestampSeconds: 0
    });
  });

  it("live QA Blocker 2 fix: a composition with no manifest.scenes entry at all (e.g. isNestedOnlyReferenced at the flat manifest level, promoted to a real scene by the grouping UI) still resolves ok with layerIndices: []", () => {
    const result = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "scene-1",
      currentPlan: validPlan(),
      // No entry in `scenes` for comp-1 at all - manifestScene resolves to undefined.
      currentProjectManifest: validManifest({ scenes: [] })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.layerIndices).toEqual([]);
    expect(result.payload.manifestCompositionId).toBe("comp-1");
    expect(result.payload.aeProjectItemIndex).toBe(5);
    expect(result.payload.compositionName).toBe("Scene 01");
  });

  it("still fails closed for an unknown scenePlanId or a missing composition even with the placeholder gate removed - identity verification is unrelated and unchanged", () => {
    const unknownScene = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "does-not-exist",
      currentPlan: validPlan(),
      currentProjectManifest: validManifest({ scenes: [] })
    });
    expect(unknownScene.ok).toBe(false);

    const missingComposition = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "scene-1",
      currentPlan: validPlan({ scenePlans: [scenePlan({ manifestCompositionId: "comp-gone" })] }),
      currentProjectManifest: validManifest({ scenes: [] })
    });
    expect(missingComposition.ok).toBe(false);
  });

  it("dedupes and caps layerIndices at MAX_LAYERS_PER_SCENE_EVIDENCE_REQUEST (20), sorted ascending", () => {
    const manyPlaceholders = Array.from({ length: 25 }, (_, i) => ({
      placeholderId: `ph-${i}`,
      displayLabel: null,
      compositionId: "comp-1",
      layerName: `Layer ${i}`,
      layerIndex: 30 - i, // descending, with a duplicate below
      layerPath: [],
      placeholderType: "unknown" as const,
      editable: true,
      sourceType: null,
      dimensions: null,
      startTimeSeconds: null,
      durationSeconds: null,
      evidence: { source: "unknown" as const, reason: "x" }
    }));
    // A genuine duplicate layerIndex - must appear only once in the result.
    manyPlaceholders.push({ ...manyPlaceholders[0]!, placeholderId: "ph-dup" });

    const result = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "scene-1",
      currentPlan: validPlan(),
      currentProjectManifest: validManifest({
        scenes: [{ sceneId: "scene-a", displayName: null, compositionId: "comp-1", originalOrderIndex: 0, startTimeSeconds: 0, durationSeconds: 5, placeholders: manyPlaceholders }]
      })
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.layerIndices).toHaveLength(20);
    expect(result.payload.layerIndices).toEqual([...result.payload.layerIndices].sort((a, b) => a - b));
    expect(new Set(result.payload.layerIndices).size).toBe(20);
  });

  it("never requires the plan to be APPROVED - read-only inspection is meant to inform mapping BEFORE approval", () => {
    const result = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "scene-1",
      currentPlan: validPlan({ scenePlans: [scenePlan({ approvalState: "UNREVIEWED", unresolvedReasons: ["no confident structural classification"] })] }),
      currentProjectManifest: validManifest()
    });
    expect(result.ok).toBe(true);
  });
});

describe("resolveInspectSceneEvidenceDispatch - previewTimingChainIndex (Preview Timing Analysis, live QA 2026-09-09)", () => {
  function nestedMapping(overrides: Partial<PlaceholderMapping> = {}): PlaceholderMapping {
    return {
      id: "mapping-1",
      manifestPlaceholderId: null,
      placeholderName: "test",
      placeholderClassification: { value: "text", source: "HUMAN", evidence: [] },
      selectedAssetId: null,
      selectedAssetType: null,
      text: null,
      assetTimestamp: null,
      colorHex: null,
      layerVisible: null,
      freezeAtSeconds: null,
      layerDurationSeconds: null,
      humanLayerIndex: null,
      humanNestedTarget: null,
      mappingSource: "HUMAN",
      confidence: null,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
      ...overrides
    };
  }

  const nestedCompositionManifest = validManifest({
    compositions: [
      { compositionId: "comp-1", aeProjectItemIndex: 5, name: "Scene 01", widthPx: 1920, heightPx: 1080, durationSeconds: 5, frameRate: 30, isNestedOnlyReferenced: false, parentCompositionIds: [] },
      { compositionId: "comp-1635", aeProjectItemIndex: 45, name: "Pre-comp 3", widthPx: 1588, heightPx: 1920, durationSeconds: 10, frameRate: 30, isNestedOnlyReferenced: true, parentCompositionIds: ["comp-1"] }
    ]
  });

  const planWithNestedMappings = validPlan({
    scenePlans: [
      scenePlan({
        mappings: [
          nestedMapping({
            id: "logo",
            humanNestedTarget: [
              { compositionId: "comp-1", layerIndex: 3 },
              { compositionId: "comp-1635", layerIndex: 1 },
              { compositionId: "comp-1044", layerIndex: 1 }
            ]
          }),
          nestedMapping({ id: "hebrew", humanNestedTarget: [{ compositionId: "comp-1", layerIndex: 3 }, { compositionId: "comp-1635", layerIndex: 4 }] })
        ]
      })
    ]
  });

  it("resolves chain index 0 to the outer wrapper composition (comp-1) shared by both mappings - never the scene's own manifestCompositionId logic", () => {
    const result = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "scene-1",
      currentPlan: planWithNestedMappings,
      currentProjectManifest: nestedCompositionManifest,
      previewTimingChainIndex: 0
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.manifestCompositionId).toBe("comp-1");
    expect(result.payload.layerIndices).toEqual([3]);
    expect(result.payload.discoverLayerDetails).toBe(true);
    expect(result.payload.previewTimestampSeconds).toBeNull();
  });

  it("resolves chain index 1 to comp-1635 with BOTH mappings' layer indices merged (1 from logo, 4 from Hebrew)", () => {
    const result = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "scene-1",
      currentPlan: planWithNestedMappings,
      currentProjectManifest: nestedCompositionManifest,
      previewTimingChainIndex: 1
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.manifestCompositionId).toBe("comp-1635");
    expect(result.payload.layerIndices).toEqual([1, 4]);
  });

  it("never reaches the logo chain's deeper comp-1044 hop - bounded to two hops by design", () => {
    const result = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "scene-1",
      currentPlan: planWithNestedMappings,
      currentProjectManifest: nestedCompositionManifest,
      previewTimingChainIndex: 2
    });
    expect(result.ok).toBe(false);
  });

  it("refuses an out-of-range chain index with a clear reason - never silently returns the wrong composition", () => {
    const result = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "scene-1",
      currentPlan: planWithNestedMappings,
      currentProjectManifest: nestedCompositionManifest,
      previewTimingChainIndex: 5
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no preview-timing target at chain index 5");
  });

  it("refuses when the scene has no nested-target mappings at all - never falls back to the scene's own top-level composition silently", () => {
    const result = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "scene-1",
      currentPlan: validPlan({ scenePlans: [scenePlan({ mappings: [] })] }),
      currentProjectManifest: validManifest(),
      previewTimingChainIndex: 0
    });
    expect(result.ok).toBe(false);
  });

  it("still requires the manifest sha256 to match the plan's - the same staleness guard as every other branch", () => {
    const result = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "scene-1",
      currentPlan: { ...planWithNestedMappings, sourceProjectSha256: "b".repeat(64) },
      currentProjectManifest: nestedCompositionManifest,
      previewTimingChainIndex: 0
    });
    expect(result.ok).toBe(false);
  });
});
