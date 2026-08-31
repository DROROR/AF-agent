import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type ScenePlanEntry, type TemplateManifest } from "@dyo/schemas";
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
      previewTimestampSeconds: null
    });
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

  it("fails closed when the scene's composition has no placeholders to inspect - never dispatches an empty layerIndices request", () => {
    const result = resolveInspectSceneEvidenceDispatch({
      scenePlanId: "scene-1",
      currentPlan: validPlan(),
      currentProjectManifest: validManifest({
        scenes: [{ sceneId: "scene-a", displayName: null, compositionId: "comp-1", originalOrderIndex: 0, startTimeSeconds: 0, durationSeconds: 5, placeholders: [] }]
      })
    });
    expect(result.ok).toBe(false);
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
