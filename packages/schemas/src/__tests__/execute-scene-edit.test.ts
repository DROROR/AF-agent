import { describe, expect, it } from "vitest";
import {
  executeSceneEditRequestSchema,
  sceneEditOperationIntentSchema,
  sceneEditOperationSchema,
  sceneEditResultSchema,
  type ExecuteSceneEditRequest
} from "../execute-scene-edit.js";

function validRequest(overrides: Partial<ExecuteSceneEditRequest> = {}): ExecuteSceneEditRequest {
  return {
    projectId: "11111111-1111-1111-1111-111111111111",
    planId: "plan-1",
    planRevision: 1,
    sourceProjectSha256: "a".repeat(64),
    sourceProjectPath: "C:\\vidio agent\\White App Promo (converted).aep",
    executionSessionId: "33333333-3333-3333-3333-333333333333",
    expectedWorkingProjectSha256: null,
    scenePlanId: "scene-1",
    manifestCompositionId: "comp-275",
    aeProjectItemIndex: 14,
    compositionName: "Scene 01",
    approvedMappingIds: ["mapping-1"],
    operations: [{ type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, text: "Hello" }],
    checkpoint: null,
    ...overrides
  };
}

describe("sceneEditOperationSchema", () => {
  it("accepts each of the seven allowlisted operation types", () => {
    const ops = [
      { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, text: "Hello" },
      { type: "MAP_FOOTAGE", manifestPlaceholderId: "ph-1", layerIndex: 1, assetPath: "/assets/clip.mp4" },
      { type: "SET_LAYER_VISIBILITY", manifestPlaceholderId: "ph-1", layerIndex: 1, visible: false },
      { type: "SET_TIME_REMAP_FREEZE", manifestPlaceholderId: "ph-1", layerIndex: 1, freezeAtSeconds: 2.5 },
      { type: "SET_DURATION", manifestPlaceholderId: "ph-1", layerIndex: 1, durationSeconds: 4 },
      { type: "SET_BRAND_COLOR", manifestPlaceholderId: "ph-1", layerIndex: 1, colorHex: "#1A2B3C" },
      {
        type: "BUILD_REELS_COMPOSITION",
        reelsCompositionName: "Scene 01 - Reels",
        layerTransforms: [{ layerIndex: 2, manifestPlaceholderId: "ph-1", positionX: 540, positionY: 960, scalePercent: 150 }]
      }
    ];
    for (const op of ops) {
      expect(() => sceneEditOperationSchema.parse(op)).not.toThrow();
    }
  });

  it("BUILD_REELS_COMPOSITION rejects an empty layerTransforms array - never a no-op reels build", () => {
    expect(() =>
      sceneEditOperationSchema.parse({ type: "BUILD_REELS_COMPOSITION", reelsCompositionName: "Reels", layerTransforms: [] })
    ).toThrow();
  });

  it("BUILD_REELS_COMPOSITION rejects a generic/arbitrary extra field - never a generic transform API", () => {
    expect(() =>
      sceneEditOperationSchema.parse({
        type: "BUILD_REELS_COMPOSITION",
        reelsCompositionName: "Reels",
        layerTransforms: [{ layerIndex: 2, manifestPlaceholderId: null, positionX: 0, positionY: 0, scalePercent: 100 }],
        arbitraryPropertyPath: "ADBE Transform Group"
      })
    ).toThrow();
  });

  it("rejects an arbitrary JSX/ExtendScript operation - no such operation type exists", () => {
    expect(() =>
      sceneEditOperationSchema.parse({ type: "RUN_JSX", script: "app.project.save();" })
    ).toThrow();
    expect(() =>
      sceneEditOperationSchema.parse({ type: "EXECUTE_EXTENDSCRIPT", code: "app.quit()" })
    ).toThrow();
  });

  it("rejects an arbitrary shell/command operation", () => {
    expect(() => sceneEditOperationSchema.parse({ type: "RUN_SHELL", command: "rm -rf /" })).toThrow();
  });

  it("rejects an arbitrary/unrecognized MCP tool name as an operation", () => {
    expect(() => sceneEditOperationSchema.parse({ type: "ae_run_jsx", script: "x" })).toThrow();
  });

  it("rejects an unsupported/unlisted edit operation type outright", () => {
    expect(() => sceneEditOperationSchema.parse({ type: "DELETE_LAYER", manifestPlaceholderId: "ph-1", layerIndex: 1 })).toThrow();
  });

  it("rejects an operation with an arbitrary free-form property path instead of a fixed field", () => {
    expect(() =>
      sceneEditOperationSchema.parse({ type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, text: "x", propertyPath: "ADBE Text Properties" })
    ).toThrow();
  });

  it("rejects a non-hex color for SET_BRAND_COLOR", () => {
    expect(() =>
      sceneEditOperationSchema.parse({ type: "SET_BRAND_COLOR", manifestPlaceholderId: "ph-1", layerIndex: 1, colorHex: "blue" })
    ).toThrow();
  });
});

describe("sceneEditOperationIntentSchema - the dispatch-facing (server -> worker) shape", () => {
  it("accepts a MAP_FOOTAGE intent with assetId/expectedSha256/mimeType - never a filesystem path", () => {
    expect(() =>
      sceneEditOperationIntentSchema.parse({
        type: "MAP_FOOTAGE",
        manifestPlaceholderId: "ph-1",
        layerIndex: 1,
        assetId: "22222222-2222-2222-2222-222222222222",
        expectedSha256: "c".repeat(64),
        mimeType: "video/mp4"
      })
    ).not.toThrow();
  });

  it("rejects a MAP_FOOTAGE intent that still tries to supply a raw assetPath", () => {
    expect(() =>
      sceneEditOperationIntentSchema.parse({
        type: "MAP_FOOTAGE",
        manifestPlaceholderId: "ph-1",
        layerIndex: 1,
        assetPath: "/some/worker/path.mp4"
      })
    ).toThrow();
  });

  it("rejects a MAP_FOOTAGE intent with a non-uuid assetId", () => {
    expect(() =>
      sceneEditOperationIntentSchema.parse({
        type: "MAP_FOOTAGE",
        manifestPlaceholderId: "ph-1",
        layerIndex: 1,
        assetId: "not-a-uuid",
        expectedSha256: "c".repeat(64),
        mimeType: "video/mp4"
      })
    ).toThrow();
  });

  it("accepts every non-asset operation type identically to the resolved schema", () => {
    const ops = [
      { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, text: "Hello" },
      { type: "SET_LAYER_VISIBILITY", manifestPlaceholderId: "ph-1", layerIndex: 1, visible: false },
      { type: "SET_TIME_REMAP_FREEZE", manifestPlaceholderId: "ph-1", layerIndex: 1, freezeAtSeconds: 2.5 },
      { type: "SET_DURATION", manifestPlaceholderId: "ph-1", layerIndex: 1, durationSeconds: 4 },
      { type: "SET_BRAND_COLOR", manifestPlaceholderId: "ph-1", layerIndex: 1, colorHex: "#1A2B3C" }
    ];
    for (const op of ops) {
      expect(() => sceneEditOperationIntentSchema.parse(op)).not.toThrow();
    }
  });
});

describe("executeSceneEditRequestSchema", () => {
  it("accepts a fully valid request", () => {
    expect(() => executeSceneEditRequestSchema.parse(validRequest())).not.toThrow();
  });

  it("rejects a request that still tries to supply workingProjectPath - the worker derives it internally now, never the caller", () => {
    const raw = { ...validRequest(), workingProjectPath: "C:\\vidio agent\\DYO-Working\\working-copy.aep" };
    expect(() => executeSceneEditRequestSchema.parse(raw)).toThrow();
  });

  it("rejects a request with zero operations", () => {
    expect(() => executeSceneEditRequestSchema.parse(validRequest({ operations: [] }))).toThrow();
  });

  it("rejects a request with zero approvedMappingIds", () => {
    expect(() => executeSceneEditRequestSchema.parse(validRequest({ approvedMappingIds: [] }))).toThrow();
  });

  it("rejects an extra/unexpected top-level field", () => {
    const raw = { ...validRequest(), arbitraryShellCommand: "rm -rf /" };
    expect(() => executeSceneEditRequestSchema.parse(raw)).toThrow();
  });

  it("requires aeProjectItemIndex - manifestCompositionId alone cannot address a real AE composition", () => {
    const raw = { ...validRequest() } as Partial<ExecuteSceneEditRequest>;
    delete raw.aeProjectItemIndex;
    expect(() => executeSceneEditRequestSchema.parse(raw)).toThrow();
  });

  it("requires compositionName - aeProjectItemIndex alone is never trusted without a name to verify against", () => {
    const raw = { ...validRequest() } as Partial<ExecuteSceneEditRequest>;
    delete raw.compositionName;
    expect(() => executeSceneEditRequestSchema.parse(raw)).toThrow();
  });

  it("rejects aeProjectItemIndex of 0 - AE's own project item addressing is 1-based, never 0-based", () => {
    expect(() => executeSceneEditRequestSchema.parse(validRequest({ aeProjectItemIndex: 0 }))).toThrow();
  });

  it("requires executionSessionId - the working copy is derived from it worker-side", () => {
    const raw = { ...validRequest() } as Partial<ExecuteSceneEditRequest>;
    delete raw.executionSessionId;
    expect(() => executeSceneEditRequestSchema.parse(raw)).toThrow();
  });

  it("accepts a null expectedWorkingProjectSha256 (a session's first scene job) and a real one (a later scene job)", () => {
    expect(() => executeSceneEditRequestSchema.parse(validRequest({ expectedWorkingProjectSha256: null }))).not.toThrow();
    expect(() => executeSceneEditRequestSchema.parse(validRequest({ expectedWorkingProjectSha256: "d".repeat(64) }))).not.toThrow();
  });
});

describe("sceneEditResultSchema", () => {
  function validResult() {
    return {
      executionSessionId: "33333333-3333-3333-3333-333333333333",
      scenePlanId: "scene-1",
      sourceProjectSha256: "a".repeat(64),
      workingProjectPath: "/work/execution-sessions/session-1/working-copy.aep",
      workingProjectSha256: "b".repeat(64),
      workingCopyFailureCode: null,
      operationsRequested: 1,
      operationsCompleted: [0],
      checkpoint: { completedOperationIndices: [0], checkpointBeforeAt: null, checkpointAfterAt: "2026-01-01T00:00:00.000Z", failureReason: null },
      previewFramePath: "/work/execution-sessions/session-1/preview.png",
      previewTimestampSeconds: 0,
      failureReason: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z"
    };
  }

  it("accepts a fully valid successful result", () => {
    expect(() => sceneEditResultSchema.parse(validResult())).not.toThrow();
  });

  it("accepts a failed result with null working-copy/preview fields (failure before a working copy could be prepared)", () => {
    expect(() =>
      sceneEditResultSchema.parse({
        ...validResult(),
        workingProjectPath: null,
        workingProjectSha256: null,
        previewFramePath: null,
        previewTimestampSeconds: null,
        operationsCompleted: [],
        failureReason: "working copy could not be prepared: SOURCE_SHA_MISMATCH"
      })
    ).not.toThrow();
  });

  it("accepts jobId/workerId only once stamped (optional)", () => {
    expect(() => sceneEditResultSchema.parse(validResult())).not.toThrow();
    expect(() => sceneEditResultSchema.parse({ ...validResult(), jobId: "job-1", workerId: "worker-1" })).not.toThrow();
  });

  it("accepts each chain-of-custody failure code, and rejects an unrecognized one", () => {
    expect(() => sceneEditResultSchema.parse({ ...validResult(), workingCopyFailureCode: "WORKING_COPY_MISSING" })).not.toThrow();
    expect(() => sceneEditResultSchema.parse({ ...validResult(), workingCopyFailureCode: "WORKING_COPY_SHA_MISMATCH" })).not.toThrow();
    expect(() => sceneEditResultSchema.parse({ ...validResult(), workingCopyFailureCode: "SOMETHING_ELSE" })).toThrow();
  });

  it("requires executionSessionId on the result too - echoed back so the API can update the right session", () => {
    const raw = validResult() as Partial<ReturnType<typeof validResult>>;
    delete raw.executionSessionId;
    expect(() => sceneEditResultSchema.parse(raw)).toThrow();
  });
});
