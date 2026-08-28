import { describe, expect, it } from "vitest";
import {
  EXECUTION_PLAN_SCHEMA_VERSION,
  executionPlanSchema,
  placeholderMappingSchema,
  scenePlanEntrySchema,
  type ExecutionPlan,
  type PlaceholderMapping,
  type ScenePlanEntry
} from "../execution-plan.js";

const NOW = "2026-08-26T00:00:00.000Z";

function validMapping(overrides: Partial<PlaceholderMapping> = {}): PlaceholderMapping {
  return {
    id: "mapping-1",
    manifestPlaceholderId: "ph-1",
    placeholderName: "Headline",
    placeholderClassification: { value: null, source: "MANIFEST", evidence: ["no confident structural signal"] },
    selectedAssetId: null,
    selectedAssetType: null,
    text: null,
    assetTimestamp: null,
    colorHex: null,
    layerVisible: null,
    freezeAtSeconds: null,
    layerDurationSeconds: null,
    mappingSource: "MANIFEST",
    confidence: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function validScene(overrides: Partial<ScenePlanEntry> = {}): ScenePlanEntry {
  return {
    id: "scene-plan-1",
    manifestCompositionId: "comp-1",
    compositionName: "Main Comp",
    use: true,
    sourcePosition: 0,
    finalOrder: 0,
    finalDuration: null,
    approvalState: "UNREVIEWED",
    instructions: null,
    notes: null,
    unresolvedReasons: [],
    evidence: [],
    mappings: [validMapping()],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

function validPlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    schemaVersion: EXECUTION_PLAN_SCHEMA_VERSION,
    id: "plan-1",
    projectId: "project-1",
    revision: 1,
    status: "DRAFT",
    templateId: "tmpl-1",
    sourceProjectSha256: "a".repeat(64),
    approvedAt: null,
    approvedBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    scenePlans: [validScene()],
    renderOutputs: { LANDSCAPE: null, REELS: null },
    ...overrides
  };
}

describe("executionPlanSchema", () => {
  it("accepts a fully valid plan", () => {
    expect(() => executionPlanSchema.parse(validPlan())).not.toThrow();
  });

  it("preserves an unknown classification (null value) rather than rejecting or coercing it", () => {
    const parsed = executionPlanSchema.parse(validPlan());
    expect(parsed.scenePlans[0]?.mappings[0]?.placeholderClassification.value).toBeNull();
  });

  it("keeps sourcePosition, finalOrder, finalDuration, and assetTimestamp as four distinct fields - never collapsed", () => {
    const plan = validPlan({
      scenePlans: [
        validScene({
          sourcePosition: 3,
          finalOrder: 7,
          finalDuration: 5.5,
          mappings: [validMapping({ assetTimestamp: 12.4 })]
        })
      ]
    });
    const parsed = executionPlanSchema.parse(plan);
    const scene = parsed.scenePlans[0];
    expect(scene?.sourcePosition).toBe(3);
    expect(scene?.finalOrder).toBe(7);
    expect(scene?.finalDuration).toBe(5.5);
    expect(scene?.mappings[0]?.assetTimestamp).toBe(12.4);
    // All four remain independently settable/readable - none derived from another.
    expect(new Set([scene?.sourcePosition, scene?.finalOrder, scene?.finalDuration, scene?.mappings[0]?.assetTimestamp]).size).toBe(4);
  });

  it("rejects a negative finalDuration", () => {
    expect(() => scenePlanEntrySchema.parse(validScene({ finalDuration: -1 }))).toThrow();
  });

  it("rejects a zero finalDuration (must be positive, not just non-negative)", () => {
    expect(() => scenePlanEntrySchema.parse(validScene({ finalDuration: 0 }))).toThrow();
  });

  it("rejects a negative assetTimestamp", () => {
    expect(() => placeholderMappingSchema.parse(validMapping({ assetTimestamp: -0.5 }))).toThrow();
  });

  it("rejects a negative sourcePosition or finalOrder", () => {
    expect(() => scenePlanEntrySchema.parse(validScene({ sourcePosition: -1 }))).toThrow();
    expect(() => scenePlanEntrySchema.parse(validScene({ finalOrder: -1 }))).toThrow();
  });

  it("rejects a malformed mapping (invalid placeholderClassification value)", () => {
    const malformed = { ...validMapping(), placeholderClassification: { value: "not_a_real_type", source: "MANIFEST", evidence: [] } };
    expect(() => placeholderMappingSchema.parse(malformed)).toThrow();
  });

  it("rejects a mapping with confidence outside [0, 1]", () => {
    expect(() => placeholderMappingSchema.parse(validMapping({ confidence: 1.5 }))).toThrow();
    expect(() => placeholderMappingSchema.parse(validMapping({ confidence: -0.1 }))).toThrow();
  });

  it("rejects an unrecognized approvalState or mappingSource", () => {
    expect(() => scenePlanEntrySchema.parse(validScene({ approvalState: "MAYBE" as never }))).toThrow();
    expect(() => placeholderMappingSchema.parse(validMapping({ mappingSource: "GUESS" as never }))).toThrow();
  });

  it("allows a scene with zero mappings (composition-level-only entry) - never forced to have at least one", () => {
    expect(() => scenePlanEntrySchema.parse(validScene({ mappings: [] }))).not.toThrow();
  });

  it("rejects an unrecognized plan status", () => {
    expect(() => executionPlanSchema.parse(validPlan({ status: "PENDING" as never }))).toThrow();
  });

  it("accepts the canonical #RRGGBB (uppercase) colorHex and rejects any non-canonical form - the persisted plan only ever stores the already-normalized value", () => {
    expect(() => placeholderMappingSchema.parse(validMapping({ colorHex: "#1A2B3C" }))).not.toThrow();
    expect(() => placeholderMappingSchema.parse(validMapping({ colorHex: "#1a2b3c" }))).toThrow(); // lowercase - not canonical
    expect(() => placeholderMappingSchema.parse(validMapping({ colorHex: "1A2B3C" }))).toThrow(); // missing '#'
    expect(() => placeholderMappingSchema.parse(validMapping({ colorHex: "#ABC" }))).toThrow(); // 3-digit shorthand - not canonical
    expect(() => placeholderMappingSchema.parse(validMapping({ colorHex: "blue" }))).toThrow();
  });

  it("keeps colorHex/layerVisible/freezeAtSeconds/layerDurationSeconds as four distinct, independently-nullable operator-intent fields - never collapsed or defaulted", () => {
    const mapping = validMapping({ colorHex: "#1A2B3C", layerVisible: false, freezeAtSeconds: 2.5, layerDurationSeconds: 4 });
    const parsed = placeholderMappingSchema.parse(mapping);
    expect(parsed.colorHex).toBe("#1A2B3C");
    expect(parsed.layerVisible).toBe(false);
    expect(parsed.freezeAtSeconds).toBe(2.5);
    expect(parsed.layerDurationSeconds).toBe(4);
  });

  it("rejects a zero/negative layerDurationSeconds (must be positive, matching the worker's own SET_DURATION contract)", () => {
    expect(() => placeholderMappingSchema.parse(validMapping({ layerDurationSeconds: 0 }))).toThrow();
    expect(() => placeholderMappingSchema.parse(validMapping({ layerDurationSeconds: -1 }))).toThrow();
  });

  it("rejects a negative freezeAtSeconds", () => {
    expect(() => placeholderMappingSchema.parse(validMapping({ freezeAtSeconds: -0.01 }))).toThrow();
  });
});
