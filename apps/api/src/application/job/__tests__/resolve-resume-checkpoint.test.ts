import { describe, expect, it } from "vitest";
import type { ExecuteSceneEditRequest, SceneEditCheckpoint } from "@dyo/schemas";
import type { Job, JobRepository } from "../../../domain/job/types.js";
import { resolveExecuteFrameResumeCheckpoint } from "../resolve-resume-checkpoint.js";

const OPERATIONS = [
  { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: null, nestedTarget: [{ compositionId: "comp-9", aeProjectItemIndex: 42, layerIndex: 1 }], text: "Headline" },
  { type: "SET_TEXT", manifestPlaceholderId: "ph-2", layerIndex: 3, nestedTarget: null, text: "Sub" }
] as unknown as ExecuteSceneEditRequest["operations"];

const RESOLVED: Omit<ExecuteSceneEditRequest, "checkpoint"> = {
  projectId: "11111111-1111-1111-1111-111111111111",
  planId: "plan-1",
  planRevision: 4,
  sourceProjectSha256: "a".repeat(64),
  sourceProjectPath: "C:\\copies\\source.aep",
  executionSessionId: "22222222-2222-2222-2222-222222222222",
  expectedWorkingProjectSha256: null,
  scenePlanId: "scene-1",
  manifestCompositionId: "comp-1",
  aeProjectItemIndex: 5,
  compositionName: "Main",
  approvedMappingIds: ["ph-1", "ph-2"],
  operations: OPERATIONS
} as Omit<ExecuteSceneEditRequest, "checkpoint">;

/** Re-orders every object's keys the way PostgreSQL jsonb returns them (shorter keys first, then bytewise). */
function jsonbOrder(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(jsonbOrder);
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(keys.map((key) => [key, jsonbOrder((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function repositoryWith(job: Partial<Job> | null): JobRepository {
  return {
    findMostRecentForSessionKey: async () => (job ? (job as Job) : null)
  } as unknown as JobRepository;
}

const SAVED: SceneEditCheckpoint = {
  completedOperationIndices: [0, 1],
  checkpointBeforeAt: null,
  checkpointAfterAt: "2026-09-15T14:16:51.796Z",
  failureReason: null,
  savedWorkingProjectSha256: "f38d5b258fbc627dcfe9c09c3e7c7b39cd6155d719fc4331d66d91ce08fad3f6"
};

function priorJob(overrides: { payload?: unknown; checkpoint?: unknown; status?: Job["status"] } = {}): Partial<Job> {
  return {
    status: overrides.status ?? "FAILED",
    payload: overrides.payload ?? jsonbOrder({ ...RESOLVED, checkpoint: null }),
    checkpoint: overrides.checkpoint ?? SAVED
  } as Partial<Job>;
}

describe("resolveExecuteFrameResumeCheckpoint (real 2026-09-15: jsonb key order made every retry start fresh)", () => {
  it("matches a stored payload whose keys PostgreSQL re-ordered, and resumes a fully applied, saved attempt", async () => {
    const stored = jsonbOrder({ ...RESOLVED, checkpoint: null }) as ExecuteSceneEditRequest;
    expect(JSON.stringify(stored.operations)).not.toBe(JSON.stringify(RESOLVED.operations));

    await expect(resolveExecuteFrameResumeCheckpoint(repositoryWith(priorJob()), RESOLVED)).resolves.toEqual(SAVED);
  });

  it("never resumes a partial checkpoint - its completed edits may only have existed unsaved in After Effects", async () => {
    const partial = { ...SAVED, completedOperationIndices: [0] };
    await expect(resolveExecuteFrameResumeCheckpoint(repositoryWith(priorJob({ checkpoint: partial })), RESOLVED)).resolves.toBeNull();
  });

  it("never resumes a full checkpoint without a verified saved working-copy hash", async () => {
    const { savedWorkingProjectSha256: _omitted, ...unsaved } = SAVED;
    await expect(resolveExecuteFrameResumeCheckpoint(repositoryWith(priorJob({ checkpoint: unsaved })), RESOLVED)).resolves.toBeNull();
    await expect(resolveExecuteFrameResumeCheckpoint(repositoryWith(priorJob({ checkpoint: { ...SAVED, savedWorkingProjectSha256: null } })), RESOLVED)).resolves.toBeNull();
  });

  it("refuses when the operations genuinely differ, even by one value", async () => {
    const changed = jsonbOrder({ ...RESOLVED, operations: [OPERATIONS[0], { ...(OPERATIONS[1] as object), text: "Different" }], checkpoint: null });
    await expect(resolveExecuteFrameResumeCheckpoint(repositoryWith(priorJob({ payload: changed })), RESOLVED)).resolves.toBeNull();
  });

  it("refuses when the plan revision or working-copy expectation differs", async () => {
    await expect(resolveExecuteFrameResumeCheckpoint(repositoryWith(priorJob({ payload: jsonbOrder({ ...RESOLVED, planRevision: 3, checkpoint: null }) })), RESOLVED)).resolves.toBeNull();
    await expect(resolveExecuteFrameResumeCheckpoint(repositoryWith(priorJob({ payload: jsonbOrder({ ...RESOLVED, expectedWorkingProjectSha256: "b".repeat(64), checkpoint: null }) })), RESOLVED)).resolves.toBeNull();
  });

  it("only resumes a FAILED prior job, and nothing when there is no prior job", async () => {
    await expect(resolveExecuteFrameResumeCheckpoint(repositoryWith(priorJob({ status: "RUNNING" })), RESOLVED)).resolves.toBeNull();
    await expect(resolveExecuteFrameResumeCheckpoint(repositoryWith(null), RESOLVED)).resolves.toBeNull();
  });
});
