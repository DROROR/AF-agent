import { describe, expect, it } from "vitest";
import { executeSceneEditRequestSchema, sceneEditOperationSchema, type ExecuteSceneEditRequest } from "../execute-scene-edit.js";

function validRequest(overrides: Partial<ExecuteSceneEditRequest> = {}): ExecuteSceneEditRequest {
  return {
    projectId: "11111111-1111-1111-1111-111111111111",
    planId: "plan-1",
    planRevision: 1,
    sourceProjectSha256: "a".repeat(64),
    sourceProjectPath: "C:\\vidio agent\\White App Promo (converted).aep",
    workingProjectPath: "C:\\vidio agent\\DYO-Working\\White App Promo (converted)-DYO-Working-v001.aep",
    scenePlanId: "scene-1",
    manifestCompositionId: "comp-275",
    approvedMappingIds: ["mapping-1"],
    operations: [{ type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, text: "Hello" }],
    checkpoint: null,
    ...overrides
  };
}

describe("sceneEditOperationSchema", () => {
  it("accepts each of the six allowlisted operation types", () => {
    const ops = [
      { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, text: "Hello" },
      { type: "MAP_FOOTAGE", manifestPlaceholderId: "ph-1", layerIndex: 1, assetPath: "/assets/clip.mp4" },
      { type: "SET_LAYER_VISIBILITY", manifestPlaceholderId: "ph-1", layerIndex: 1, visible: false },
      { type: "SET_TIME_REMAP_FREEZE", manifestPlaceholderId: "ph-1", layerIndex: 1, freezeAtSeconds: 2.5 },
      { type: "SET_DURATION", manifestPlaceholderId: "ph-1", layerIndex: 1, durationSeconds: 4 },
      { type: "SET_BRAND_COLOR", manifestPlaceholderId: "ph-1", layerIndex: 1, colorHex: "#1A2B3C" }
    ];
    for (const op of ops) {
      expect(() => sceneEditOperationSchema.parse(op)).not.toThrow();
    }
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

describe("executeSceneEditRequestSchema", () => {
  it("accepts a fully valid request", () => {
    expect(() => executeSceneEditRequestSchema.parse(validRequest())).not.toThrow();
  });

  it("rejects when workingProjectPath equals sourceProjectPath - the original .aep is never a mutation target", () => {
    expect(() =>
      executeSceneEditRequestSchema.parse(
        validRequest({ workingProjectPath: "C:\\vidio agent\\White App Promo (converted).aep" })
      )
    ).toThrow();
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
});
