import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type ScenePlanEntry, type TemplateManifest } from "@dyo/schemas";
import { findNonContentPlaceholderBlockers } from "../approve-execution-plan.js";

// REAL 2026-10-09 (QA project `mega`): a picture on the template's camera
// passed approval and failed the first frame. The gate now refuses it, in the
// same words the edit and the dispatcher use.
function manifest(): TemplateManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: "t",
    templateName: "t",
    sourceProject: { path: "/copies/t.aep", name: "t.aep", sha256: "a".repeat(64) },
    afterEffects: { version: "26.3x87" },
    generatedAt: "2026-10-09T00:00:00.000Z",
    compositions: [],
    scenes: [
      {
        sceneId: "s",
        compositionId: "comp-1",
        displayName: null,
        durationSeconds: 5,
        placeholders: [
          { placeholderId: "ph-camera", displayLabel: null, compositionId: "comp-1", layerName: "Camera 1", layerIndex: 1, layerPath: [], placeholderType: "unknown", editable: false, sourceType: "CameraLayer", dimensions: null, startTimeSeconds: 0, durationSeconds: 5, evidence: { source: "unknown", reason: "x" } },
          { placeholderId: "ph-pic", displayLabel: null, compositionId: "comp-1", layerName: "Photo", layerIndex: 2, layerPath: [], placeholderType: "image", editable: true, sourceType: "AVLayer", dimensions: null, startTimeSeconds: 0, durationSeconds: 5, evidence: { source: "read_directly", reason: "x" } }
        ] as never
      } as never
    ],
    preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
    unknownItems: []
  };
}

function mapping(id: string, placeholderId: string, content: { selectedAssetId?: string; text?: string }) {
  return {
    id,
    manifestPlaceholderId: placeholderId,
    placeholderName: id,
    placeholderClassification: { value: null, source: "MANIFEST", evidence: [] },
    selectedAssetId: content.selectedAssetId ?? null,
    selectedAssetType: content.selectedAssetId ? "image" : null,
    text: content.text ?? null,
    assetTimestamp: null,
    colorHex: null,
    layerVisible: null,
    freezeAtSeconds: null,
    layerDurationSeconds: null,
    humanLayerIndex: null,
    humanNestedTarget: null,
    mappingSource: "MANIFEST",
    confidence: null,
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z"
  };
}

function scene(use: boolean, mappings: unknown[]): ScenePlanEntry {
  return { id: "scene-1", manifestCompositionId: "comp-1", compositionName: "Scene", use, order: 0, approvalState: "READY_FOR_APPROVAL", unresolvedReasons: [], mappings, createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z" } as never;
}

describe("findNonContentPlaceholderBlockers", () => {
  it("names a picture on the camera, in a client's words", () => {
    const blockers = findNonContentPlaceholderBlockers([scene(true, [mapping("m-cam", "ph-camera", { selectedAssetId: "a" }), mapping("m-pic", "ph-pic", { selectedAssetId: "a" })])], manifest());
    expect(blockers).toEqual(['"Camera 1" is part of the template\'s own setup (a camera) and cannot hold a picture - remove the picture from it on the Scenes tab']);
  });

  it("a camera carrying nothing, a picture on a real slot, and an excluded scene raise nothing", () => {
    expect(findNonContentPlaceholderBlockers([scene(true, [mapping("m-cam", "ph-camera", {}), mapping("m-pic", "ph-pic", { selectedAssetId: "a", text: "x" })])], manifest())).toEqual([]);
    expect(findNonContentPlaceholderBlockers([scene(false, [mapping("m-cam", "ph-camera", { selectedAssetId: "a" })])], manifest())).toEqual([]);
  });
});
