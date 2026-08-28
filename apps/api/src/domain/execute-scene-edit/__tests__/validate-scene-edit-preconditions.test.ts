import { describe, expect, it } from "vitest";
import type { ExecuteSceneEditRequest, PlaceholderMapping, ScenePlanEntry } from "@dyo/schemas";
import { validateSceneEditPreconditions, type SceneEditWorkerSnapshot } from "../validate-scene-edit-preconditions.js";

const NOW = new Date("2026-08-26T00:00:00.000Z");
const SHA = "a".repeat(64);

function mapping(overrides: Partial<PlaceholderMapping> = {}): PlaceholderMapping {
  return {
    id: "mapping-1",
    manifestPlaceholderId: "ph-1",
    placeholderName: "Headline",
    placeholderClassification: { value: "text", source: "HUMAN", evidence: ["visually confirmed by operator"] },
    selectedAssetId: null,
    selectedAssetType: null,
    text: "Approved Copy",
    assetTimestamp: null,
    colorHex: null,
    layerVisible: null,
    freezeAtSeconds: null,
    layerDurationSeconds: null,
    mappingSource: "HUMAN",
    confidence: null,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    ...overrides
  };
}

function scene(overrides: Partial<ScenePlanEntry> = {}): ScenePlanEntry {
  return {
    id: "scene-1",
    manifestCompositionId: "comp-275",
    compositionName: "Text 01",
    use: true,
    sourcePosition: 14,
    finalOrder: 14,
    finalDuration: 4,
    approvalState: "APPROVED",
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

function goodWorker(overrides: Partial<SceneEditWorkerSnapshot> = {}): SceneEditWorkerSnapshot {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    status: "ONLINE",
    aeStatus: "ONLINE",
    mcpStatus: "ONLINE",
    capabilities: ["EXECUTE_FRAME"],
    currentJobId: null,
    lastHeartbeatAt: new Date(NOW.getTime() - 5_000),
    ...overrides
  };
}

function request(overrides: Partial<ExecuteSceneEditRequest> = {}): ExecuteSceneEditRequest {
  return {
    projectId: "11111111-1111-1111-1111-111111111111",
    planId: "plan-1",
    planRevision: 1,
    sourceProjectSha256: SHA,
    sourceProjectPath: "C:\\vidio agent\\White App Promo (converted).aep",
    executionSessionId: "55555555-5555-5555-5555-555555555555",
    expectedWorkingProjectSha256: null,
    scenePlanId: "scene-1",
    manifestCompositionId: "comp-275",
    aeProjectItemIndex: 14,
    compositionName: "Text 01",
    approvedMappingIds: ["mapping-1"],
    operations: [{ type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, text: "Approved Copy" }],
    checkpoint: null,
    ...overrides
  };
}

function baseInput(overrides: Partial<Parameters<typeof validateSceneEditPreconditions>[0]> = {}) {
  return {
    request: request(),
    currentPlan: { id: "plan-1", revision: 1, sourceProjectSha256: SHA, scenePlans: [scene()] },
    currentProjectSourceProjectSha256: SHA,
    worker: goodWorker(),
    now: NOW,
    staleAfterMs: 30_000,
    ...overrides
  };
}

describe("validateSceneEditPreconditions", () => {
  it("accepts a fully valid, approved, resolved request", () => {
    expect(validateSceneEditPreconditions(baseInput())).toEqual({ ok: true });
  });

  it("rejects when the scene is not APPROVED", () => {
    const result = validateSceneEditPreconditions(
      baseInput({ currentPlan: { id: "plan-1", revision: 1, sourceProjectSha256: SHA, scenePlans: [scene({ approvalState: "UNREVIEWED" })] } })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects when the referenced mapping is not resolved (SET_TEXT value differs from the approved mapping's own text)", () => {
    const result = validateSceneEditPreconditions(
      baseInput({ request: request({ operations: [{ type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, text: "Different unapproved text" }] }) })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects MAP_FOOTAGE when the mapping has no approved selectedAssetId", () => {
    const result = validateSceneEditPreconditions(
      baseInput({
        currentPlan: {
          id: "plan-1",
          revision: 1,
          sourceProjectSha256: SHA,
          scenePlans: [scene({ mappings: [mapping({ selectedAssetId: null })] })]
        },
        request: request({
          operations: [
            { type: "MAP_FOOTAGE", manifestPlaceholderId: "ph-1", layerIndex: 1, assetId: "22222222-2222-2222-2222-222222222222", expectedSha256: "c".repeat(64), mimeType: "video/mp4" }
          ]
        })
      })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a stale plan revision", () => {
    const result = validateSceneEditPreconditions(baseInput({ request: request({ planRevision: 99 }) }));
    expect(result.ok).toBe(false);
  });

  it("rejects when the request's sourceProjectSha256 does not match the plan's own", () => {
    const result = validateSceneEditPreconditions(baseInput({ request: request({ sourceProjectSha256: "b".repeat(64) }) }));
    expect(result.ok).toBe(false);
  });

  it("rejects when the project's CURRENT manifest sha256 no longer matches (source project changed)", () => {
    const result = validateSceneEditPreconditions(baseInput({ currentProjectSourceProjectSha256: "b".repeat(64) }));
    expect(result.ok).toBe(false);
  });

  it("rejects when no plan exists at all", () => {
    const result = validateSceneEditPreconditions(baseInput({ currentPlan: null }));
    expect(result.ok).toBe(false);
  });

  it("rejects when the worker has never reported in", () => {
    const result = validateSceneEditPreconditions(baseInput({ worker: null }));
    expect(result.ok).toBe(false);
  });

  it("rejects when the worker's heartbeat is stale", () => {
    const result = validateSceneEditPreconditions(
      baseInput({ worker: goodWorker({ lastHeartbeatAt: new Date(NOW.getTime() - 60_000) }) })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects when AE is not ONLINE", () => {
    expect(validateSceneEditPreconditions(baseInput({ worker: goodWorker({ aeStatus: "OFFLINE" }) })).ok).toBe(false);
  });

  it("rejects when MCP is not ONLINE", () => {
    expect(validateSceneEditPreconditions(baseInput({ worker: goodWorker({ mcpStatus: "OFFLINE" }) })).ok).toBe(false);
  });

  it("rejects when the worker does not report the EXECUTE_FRAME capability", () => {
    expect(validateSceneEditPreconditions(baseInput({ worker: goodWorker({ capabilities: ["CHECK_HEALTH"] }) })).ok).toBe(false);
  });

  it("rejects when the worker already has a job in progress", () => {
    expect(validateSceneEditPreconditions(baseInput({ worker: goodWorker({ currentJobId: "some-job" }) })).ok).toBe(false);
  });

  it("rejects an operation referencing a mapping ID not in approvedMappingIds", () => {
    const result = validateSceneEditPreconditions(
      baseInput({
        currentPlan: {
          id: "plan-1",
          revision: 1,
          sourceProjectSha256: SHA,
          scenePlans: [scene({ mappings: [mapping(), mapping({ id: "mapping-2", manifestPlaceholderId: "ph-2" })] })]
        },
        request: request({ operations: [{ type: "SET_TEXT", manifestPlaceholderId: "ph-2", layerIndex: 2, text: "x" }] })
      })
    );
    expect(result.ok).toBe(false);
  });
});
