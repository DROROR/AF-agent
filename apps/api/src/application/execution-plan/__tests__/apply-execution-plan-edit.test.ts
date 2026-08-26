import { describe, expect, it } from "vitest";
import type { PlaceholderMapping, ScenePlanEntry } from "@dyo/schemas";
import { applyExecutionPlanEdit } from "../apply-execution-plan-edit.js";

const NOW = new Date("2026-08-26T00:00:00.000Z");
const fixedNow = () => NOW;

function mapping(overrides: Partial<PlaceholderMapping> = {}): PlaceholderMapping {
  return {
    id: "mapping-1",
    manifestPlaceholderId: "ph-1",
    placeholderName: "Headline",
    placeholderClassification: { value: null, source: "MANIFEST", evidence: ["unknown"] },
    selectedAssetId: null,
    selectedAssetType: null,
    text: null,
    assetTimestamp: null,
    mappingSource: "MANIFEST",
    confidence: null,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    ...overrides
  };
}

function scene(overrides: Partial<ScenePlanEntry> = {}): ScenePlanEntry {
  return {
    id: "scene-1",
    manifestCompositionId: "comp-1",
    compositionName: "Scene A",
    use: true,
    sourcePosition: 0,
    finalOrder: 0,
    finalDuration: null,
    approvalState: "UNREVIEWED",
    instructions: null,
    notes: null,
    unresolvedReasons: [],
    evidence: [],
    mappings: [mapping()],
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    ...overrides
  };
}

describe("applyExecutionPlanEdit", () => {
  it("rejects an operation referencing an unknown scenePlanId", () => {
    const result = applyExecutionPlanEdit([scene()], { type: "INCLUDE_SCENE", scenePlanId: "does-not-exist" }, fixedNow);
    expect(result.ok).toBe(false);
  });

  it("rejects an operation referencing an unknown mappingId", () => {
    const result = applyExecutionPlanEdit(
      [scene()],
      { type: "SET_TEXT", scenePlanId: "scene-1", mappingId: "does-not-exist", text: "hi" },
      fixedNow
    );
    expect(result.ok).toBe(false);
  });

  it("INCLUDE_SCENE / EXCLUDE_SCENE toggle use and bump updatedAt", () => {
    const excluded = applyExecutionPlanEdit([scene({ use: true })], { type: "EXCLUDE_SCENE", scenePlanId: "scene-1" }, fixedNow);
    expect(excluded.ok && excluded.scenePlans[0]?.use).toBe(false);
    expect(excluded.ok && excluded.scenePlans[0]?.updatedAt).toBe(NOW.toISOString());

    const included = applyExecutionPlanEdit([scene({ use: false })], { type: "INCLUDE_SCENE", scenePlanId: "scene-1" }, fixedNow);
    expect(included.ok && included.scenePlans[0]?.use).toBe(true);
  });

  it("SET_FINAL_ORDER reorders output independently of sourcePosition", () => {
    const result = applyExecutionPlanEdit([scene({ sourcePosition: 0, finalOrder: 0 })], { type: "SET_FINAL_ORDER", scenePlanId: "scene-1", finalOrder: 9 }, fixedNow);
    expect(result.ok && result.scenePlans[0]?.finalOrder).toBe(9);
    expect(result.ok && result.scenePlans[0]?.sourcePosition).toBe(0);
  });

  it("rejects SET_FINAL_ORDER when the order is already used by another INCLUDED scene", () => {
    const scenes = [scene({ id: "s1", use: true, finalOrder: 0 }), scene({ id: "s2", use: true, finalOrder: 1 })];
    const result = applyExecutionPlanEdit(scenes, { type: "SET_FINAL_ORDER", scenePlanId: "s1", finalOrder: 1 }, fixedNow);
    expect(result.ok).toBe(false);
  });

  it("allows a duplicate finalOrder among EXCLUDED scenes (not prohibited there)", () => {
    const scenes = [scene({ id: "s1", use: true, finalOrder: 0 }), scene({ id: "s2", use: false, finalOrder: 1 })];
    const result = applyExecutionPlanEdit(scenes, { type: "SET_FINAL_ORDER", scenePlanId: "s2", finalOrder: 0 }, fixedNow);
    expect(result.ok).toBe(true);
  });

  it("MAP_ASSET / CLEAR_ASSET set and clear selectedAssetId/selectedAssetType on the exact mapping", () => {
    const mapped = applyExecutionPlanEdit(
      [scene()],
      { type: "MAP_ASSET", scenePlanId: "scene-1", mappingId: "mapping-1", selectedAssetId: "asset-9", selectedAssetType: "video" },
      fixedNow
    );
    expect(mapped.ok && mapped.scenePlans[0]?.mappings[0]?.selectedAssetId).toBe("asset-9");
    expect(mapped.ok && mapped.scenePlans[0]?.mappings[0]?.selectedAssetType).toBe("video");

    const cleared = applyExecutionPlanEdit(
      [scene({ mappings: [mapping({ selectedAssetId: "asset-9", selectedAssetType: "video" })] })],
      { type: "CLEAR_ASSET", scenePlanId: "scene-1", mappingId: "mapping-1" },
      fixedNow
    );
    expect(cleared.ok && cleared.scenePlans[0]?.mappings[0]?.selectedAssetId).toBeNull();
    expect(cleared.ok && cleared.scenePlans[0]?.mappings[0]?.selectedAssetType).toBeNull();
  });

  it("SET_TEXT / CLEAR_TEXT", () => {
    const set = applyExecutionPlanEdit([scene()], { type: "SET_TEXT", scenePlanId: "scene-1", mappingId: "mapping-1", text: "Hello" }, fixedNow);
    expect(set.ok && set.scenePlans[0]?.mappings[0]?.text).toBe("Hello");

    const cleared = applyExecutionPlanEdit(
      [scene({ mappings: [mapping({ text: "Hello" })] })],
      { type: "CLEAR_TEXT", scenePlanId: "scene-1", mappingId: "mapping-1" },
      fixedNow
    );
    expect(cleared.ok && cleared.scenePlans[0]?.mappings[0]?.text).toBeNull();
  });

  it("SET_ASSET_TIMESTAMP / CLEAR_ASSET_TIMESTAMP - independent of finalDuration", () => {
    const set = applyExecutionPlanEdit(
      [scene({ finalDuration: 5 })],
      { type: "SET_ASSET_TIMESTAMP", scenePlanId: "scene-1", mappingId: "mapping-1", assetTimestamp: 12.4 },
      fixedNow
    );
    expect(set.ok && set.scenePlans[0]?.mappings[0]?.assetTimestamp).toBe(12.4);
    expect(set.ok && set.scenePlans[0]?.finalDuration).toBe(5);

    const cleared = applyExecutionPlanEdit(
      [scene({ mappings: [mapping({ assetTimestamp: 12.4 })] })],
      { type: "CLEAR_ASSET_TIMESTAMP", scenePlanId: "scene-1", mappingId: "mapping-1" },
      fixedNow
    );
    expect(cleared.ok && cleared.scenePlans[0]?.mappings[0]?.assetTimestamp).toBeNull();
  });

  it("SET_FINAL_DURATION / CLEAR_FINAL_DURATION - independent of assetTimestamp", () => {
    const set = applyExecutionPlanEdit([scene()], { type: "SET_FINAL_DURATION", scenePlanId: "scene-1", finalDuration: 6.5 }, fixedNow);
    expect(set.ok && set.scenePlans[0]?.finalDuration).toBe(6.5);

    const cleared = applyExecutionPlanEdit([scene({ finalDuration: 6.5 })], { type: "CLEAR_FINAL_DURATION", scenePlanId: "scene-1" }, fixedNow);
    expect(cleared.ok && cleared.scenePlans[0]?.finalDuration).toBeNull();
  });

  it("SET_INSTRUCTIONS / CLEAR_INSTRUCTIONS", () => {
    const set = applyExecutionPlanEdit([scene()], { type: "SET_INSTRUCTIONS", scenePlanId: "scene-1", instructions: "crop center" }, fixedNow);
    expect(set.ok && set.scenePlans[0]?.instructions).toBe("crop center");

    const cleared = applyExecutionPlanEdit([scene({ instructions: "crop center" })], { type: "CLEAR_INSTRUCTIONS", scenePlanId: "scene-1" }, fixedNow);
    expect(cleared.ok && cleared.scenePlans[0]?.instructions).toBeNull();
  });

  it("APPROVE_SCENE sets approvalState to APPROVED", () => {
    const result = applyExecutionPlanEdit([scene()], { type: "APPROVE_SCENE", scenePlanId: "scene-1" }, fixedNow);
    expect(result.ok && result.scenePlans[0]?.approvalState).toBe("APPROVED");
  });

  it("REJECT_SCENE sets approvalState to REJECTED and merges the reason into notes", () => {
    const result = applyExecutionPlanEdit([scene({ notes: "existing note" })], { type: "REJECT_SCENE", scenePlanId: "scene-1", reason: "wrong asset" }, fixedNow);
    expect(result.ok && result.scenePlans[0]?.approvalState).toBe("REJECTED");
    expect(result.ok && result.scenePlans[0]?.notes).toBe("existing note\nwrong asset");
  });

  it("never mutates the input array/objects - returns a new structure", () => {
    const original = [scene()];
    const originalMapping = original[0]?.mappings[0];
    applyExecutionPlanEdit(original, { type: "SET_TEXT", scenePlanId: "scene-1", mappingId: "mapping-1", text: "Hello" }, fixedNow);
    expect(original[0]?.mappings[0]).toBe(originalMapping);
    expect(original[0]?.mappings[0]?.text).toBeNull();
  });
});
