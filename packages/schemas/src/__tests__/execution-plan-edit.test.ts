import { describe, expect, it } from "vitest";
import {
  executionPlanEditOperationSchema,
  updateExecutionPlanRequestSchema,
  type ExecutionPlanEditOperation
} from "../execution-plan-edit.js";

const VALID_OPERATIONS: ExecutionPlanEditOperation[] = [
  { type: "INCLUDE_SCENE", scenePlanId: "s1" },
  { type: "EXCLUDE_SCENE", scenePlanId: "s1" },
  { type: "SET_FINAL_ORDER", scenePlanId: "s1", finalOrder: 2 },
  { type: "MAP_ASSET", scenePlanId: "s1", mappingId: "m1", selectedAssetId: "asset-1", selectedAssetType: "image" },
  { type: "CLEAR_ASSET", scenePlanId: "s1", mappingId: "m1" },
  { type: "SET_TEXT", scenePlanId: "s1", mappingId: "m1", text: "Hello" },
  { type: "CLEAR_TEXT", scenePlanId: "s1", mappingId: "m1" },
  { type: "SET_ASSET_TIMESTAMP", scenePlanId: "s1", mappingId: "m1", assetTimestamp: 4.2 },
  { type: "CLEAR_ASSET_TIMESTAMP", scenePlanId: "s1", mappingId: "m1" },
  { type: "SET_FINAL_DURATION", scenePlanId: "s1", finalDuration: 5 },
  { type: "CLEAR_FINAL_DURATION", scenePlanId: "s1" },
  { type: "SET_INSTRUCTIONS", scenePlanId: "s1", instructions: "crop to center" },
  { type: "CLEAR_INSTRUCTIONS", scenePlanId: "s1" },
  { type: "SET_BRAND_COLOR", scenePlanId: "s1", mappingId: "m1", colorHex: "#1A2B3C" },
  { type: "CLEAR_BRAND_COLOR", scenePlanId: "s1", mappingId: "m1" },
  { type: "SET_LAYER_VISIBILITY", scenePlanId: "s1", mappingId: "m1", enabled: false },
  { type: "CLEAR_LAYER_VISIBILITY", scenePlanId: "s1", mappingId: "m1" },
  { type: "SET_TIME_REMAP_FREEZE", scenePlanId: "s1", mappingId: "m1", freezeAtSeconds: 2.5 },
  { type: "CLEAR_TIME_REMAP_FREEZE", scenePlanId: "s1", mappingId: "m1" },
  { type: "SET_LAYER_DURATION", scenePlanId: "s1", mappingId: "m1", layerDurationSeconds: 4 },
  { type: "CLEAR_LAYER_DURATION", scenePlanId: "s1", mappingId: "m1" },
  { type: "APPROVE_SCENE", scenePlanId: "s1" },
  { type: "REJECT_SCENE", scenePlanId: "s1", reason: "wrong asset" },
  {
    type: "SET_REELS_LAYOUT",
    scenePlanId: "s1",
    reelsCompositionName: "Scene A - Reels",
    layerTransforms: [{ layerIndex: 2, manifestPlaceholderId: "ph-1", positionX: 540, positionY: 960, scalePercent: 150 }]
  },
  { type: "CLEAR_REELS_LAYOUT", scenePlanId: "s1" }
];

describe("executionPlanEditOperationSchema", () => {
  it.each(VALID_OPERATIONS)("accepts a valid $type operation", (operation) => {
    expect(() => executionPlanEditOperationSchema.parse(operation)).not.toThrow();
  });

  it("rejects an operation type outside the allowlist - never a generic patch", () => {
    expect(() => executionPlanEditOperationSchema.parse({ type: "DELETE_EVERYTHING", scenePlanId: "s1" })).toThrow();
    expect(() => executionPlanEditOperationSchema.parse({ type: "RUN_JSX", script: "app.quit()" })).toThrow();
  });

  it("rejects SET_FINAL_ORDER with a negative order", () => {
    expect(() => executionPlanEditOperationSchema.parse({ type: "SET_FINAL_ORDER", scenePlanId: "s1", finalOrder: -1 })).toThrow();
  });

  it("rejects SET_FINAL_DURATION with a zero or negative duration", () => {
    expect(() => executionPlanEditOperationSchema.parse({ type: "SET_FINAL_DURATION", scenePlanId: "s1", finalDuration: 0 })).toThrow();
    expect(() => executionPlanEditOperationSchema.parse({ type: "SET_FINAL_DURATION", scenePlanId: "s1", finalDuration: -5 })).toThrow();
  });

  it("rejects SET_ASSET_TIMESTAMP with a negative timestamp", () => {
    expect(() =>
      executionPlanEditOperationSchema.parse({ type: "SET_ASSET_TIMESTAMP", scenePlanId: "s1", mappingId: "m1", assetTimestamp: -1 })
    ).toThrow();
  });

  it("rejects MAP_ASSET with an invalid selectedAssetType", () => {
    expect(() =>
      executionPlanEditOperationSchema.parse({
        type: "MAP_ASSET",
        scenePlanId: "s1",
        mappingId: "m1",
        selectedAssetId: "asset-1",
        selectedAssetType: "not_a_real_type"
      })
    ).toThrow();
  });

  it("rejects an operation missing a required field", () => {
    expect(() => executionPlanEditOperationSchema.parse({ type: "SET_TEXT", scenePlanId: "s1" })).toThrow();
    expect(() => executionPlanEditOperationSchema.parse({ type: "REJECT_SCENE", scenePlanId: "s1" })).toThrow();
  });

  it("rejects an operation with an extra/unexpected field (e.g. a command string)", () => {
    expect(() =>
      executionPlanEditOperationSchema.parse({ type: "INCLUDE_SCENE", scenePlanId: "s1", cmd: "rm -rf /" })
    ).toThrow();
  });

  it("accepts SET_BRAND_COLOR with a 3-digit or 6-digit hex, with or without a leading '#' - the operator-facing input is more forgiving than the canonical persisted form", () => {
    for (const colorHex of ["#1A2B3C", "1A2B3C", "#abc", "abc", "#ABC"]) {
      expect(() => executionPlanEditOperationSchema.parse({ type: "SET_BRAND_COLOR", scenePlanId: "s1", mappingId: "m1", colorHex })).not.toThrow();
    }
  });

  it("rejects SET_BRAND_COLOR with a non-hex or wrong-length value - never silently coerced", () => {
    for (const colorHex of ["blue", "#12345", "#1234567", "", "rgb(0,0,0)"]) {
      expect(() => executionPlanEditOperationSchema.parse({ type: "SET_BRAND_COLOR", scenePlanId: "s1", mappingId: "m1", colorHex })).toThrow();
    }
  });

  it("rejects SET_TIME_REMAP_FREEZE with a negative freezeAtSeconds", () => {
    expect(() =>
      executionPlanEditOperationSchema.parse({ type: "SET_TIME_REMAP_FREEZE", scenePlanId: "s1", mappingId: "m1", freezeAtSeconds: -1 })
    ).toThrow();
  });

  it("rejects SET_LAYER_DURATION with a zero or negative layerDurationSeconds", () => {
    expect(() =>
      executionPlanEditOperationSchema.parse({ type: "SET_LAYER_DURATION", scenePlanId: "s1", mappingId: "m1", layerDurationSeconds: 0 })
    ).toThrow();
    expect(() =>
      executionPlanEditOperationSchema.parse({ type: "SET_LAYER_DURATION", scenePlanId: "s1", mappingId: "m1", layerDurationSeconds: -2 })
    ).toThrow();
  });

  it("rejects SET_LAYER_VISIBILITY with a non-boolean enabled value", () => {
    expect(() =>
      executionPlanEditOperationSchema.parse({ type: "SET_LAYER_VISIBILITY", scenePlanId: "s1", mappingId: "m1", enabled: "yes" })
    ).toThrow();
  });
});

describe("updateExecutionPlanRequestSchema", () => {
  it("requires baseRevision and at least one operation", () => {
    expect(() =>
      updateExecutionPlanRequestSchema.parse({ baseRevision: 1, operations: [{ type: "INCLUDE_SCENE", scenePlanId: "s1" }] })
    ).not.toThrow();
    expect(() => updateExecutionPlanRequestSchema.parse({ baseRevision: 1, operations: [] })).toThrow();
    expect(() => updateExecutionPlanRequestSchema.parse({ operations: [{ type: "INCLUDE_SCENE", scenePlanId: "s1" }] })).toThrow();
  });
});

describe("SET_TEMPLATE_TEXT_DECISION / CLEAR_TEMPLATE_TEXT_DECISION", () => {
  it("accepts each of the two explicit decisions", () => {
    for (const decision of ["REPLACE", "KEEP_TEMPLATE_TEXT"]) {
      expect(() =>
        executionPlanEditOperationSchema.parse({ type: "SET_TEMPLATE_TEXT_DECISION", scenePlanId: "scene-1", mappingId: "mapping-1", decision })
      ).not.toThrow();
    }
  });

  it("rejects any other decision value, and a missing one - there is no implicit default", () => {
    expect(() =>
      executionPlanEditOperationSchema.parse({ type: "SET_TEMPLATE_TEXT_DECISION", scenePlanId: "scene-1", mappingId: "mapping-1", decision: "MAYBE" })
    ).toThrow();
    expect(() => executionPlanEditOperationSchema.parse({ type: "SET_TEMPLATE_TEXT_DECISION", scenePlanId: "scene-1", mappingId: "mapping-1" })).toThrow();
  });

  it("rejects unknown extra fields, like every other edit operation", () => {
    expect(() =>
      executionPlanEditOperationSchema.parse({
        type: "SET_TEMPLATE_TEXT_DECISION",
        scenePlanId: "scene-1",
        mappingId: "mapping-1",
        decision: "REPLACE",
        decidedBy: "someone the caller made up"
      })
    ).toThrow();
  });

  it("clearing needs only the scene and mapping", () => {
    expect(() => executionPlanEditOperationSchema.parse({ type: "CLEAR_TEMPLATE_TEXT_DECISION", scenePlanId: "scene-1", mappingId: "mapping-1" })).not.toThrow();
    expect(() => executionPlanEditOperationSchema.parse({ type: "CLEAR_TEMPLATE_TEXT_DECISION", scenePlanId: "scene-1" })).toThrow();
  });
});

describe("SET_SLOT_REVIEW / CLEAR_SLOT_REVIEW", () => {
  const base = { type: "SET_SLOT_REVIEW", scenePlanId: "scene-1", mappingId: "mapping-1" };

  it("accepts an acceptance, and an override that names what the slot actually is", () => {
    expect(() => executionPlanEditOperationSchema.parse({ ...base, decision: "ACCEPT" })).not.toThrow();
    expect(() =>
      executionPlanEditOperationSchema.parse({ ...base, decision: "OVERRIDE_CLASSIFICATION", classification: "device_screen", evidenceFrameStorageKey: "evidence/f.png" })
    ).not.toThrow();
  });

  it("rejects an invented decision or classification, and a missing decision", () => {
    expect(() => executionPlanEditOperationSchema.parse({ ...base, decision: "PROBABLY_FINE" })).toThrow();
    expect(() => executionPlanEditOperationSchema.parse({ ...base, decision: "OVERRIDE_CLASSIFICATION", classification: "a phone I think" })).toThrow();
    expect(() => executionPlanEditOperationSchema.parse(base)).toThrow();
  });

  it("never accepts the decider's identity or the findings digest from the caller - the server supplies both", () => {
    expect(() => executionPlanEditOperationSchema.parse({ ...base, decision: "ACCEPT", decidedBy: "someone the caller made up" })).toThrow();
    expect(() => executionPlanEditOperationSchema.parse({ ...base, decision: "ACCEPT", evidenceDigest: "f".repeat(64) })).toThrow();
  });

  it("rejects an empty evidence-frame key rather than storing a reference to nothing", () => {
    expect(() => executionPlanEditOperationSchema.parse({ ...base, decision: "ACCEPT", evidenceFrameStorageKey: "" })).toThrow();
  });

  it("clearing needs only the scene and mapping", () => {
    expect(() => executionPlanEditOperationSchema.parse({ type: "CLEAR_SLOT_REVIEW", scenePlanId: "scene-1", mappingId: "mapping-1" })).not.toThrow();
    expect(() => executionPlanEditOperationSchema.parse({ type: "CLEAR_SLOT_REVIEW", scenePlanId: "scene-1" })).toThrow();
  });
});
