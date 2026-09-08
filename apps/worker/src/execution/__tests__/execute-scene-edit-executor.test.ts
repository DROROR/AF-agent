import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecuteSceneEditRequest, SceneEditCheckpoint, SceneEditOperation, SceneEditOperationIntent } from "@dyo/schemas";
import { executeSceneEdit, type ResolveOperation } from "../execute-scene-edit-executor.js";
import type { AeEditBridge, OpenProjectResult, OperationExecutionResult, SaveProjectResult } from "../ae-edit-bridge.js";
import type { PreviewCapture, PreviewCaptureResult } from "../preview-capture.js";

/** No MAP_FOOTAGE in these fixtures - every intent is already a resolved operation, so this is a pure pass-through (the real resolver's own asset-download/verification behavior is covered separately, in resolve-scene-edit-operation.test.ts). */
const defaultResolveOperation: ResolveOperation = async (intent) => ({ ok: true, operation: intent as SceneEditOperation });

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function makeSourceProject(): { root: string; sourcePath: string; sha256: string } {
  const root = mkdtempSync(join(tmpdir(), "execute-scene-edit-test-"));
  cleanupDirs.push(root);
  const sourcePath = join(root, "source.aep");
  const content = "fake-aep-bytes";
  writeFileSync(sourcePath, content);
  return { root, sourcePath, sha256: sha256(content) };
}

const OP_0: SceneEditOperationIntent = { type: "SET_TEXT", manifestPlaceholderId: "ph-1", layerIndex: 1, nestedTarget: null, text: "first" };
const OP_1: SceneEditOperationIntent = { type: "SET_LAYER_VISIBILITY", manifestPlaceholderId: "ph-2", layerIndex: 2, visible: false };

const EXECUTION_SESSION_ID = "session-1";

function makeRequest(overrides: Partial<ExecuteSceneEditRequest> & { sourceProjectPath: string; sourceProjectSha256: string }): ExecuteSceneEditRequest {
  return {
    projectId: "11111111-1111-1111-1111-111111111111",
    planId: "plan-1",
    planRevision: 1,
    executionSessionId: EXECUTION_SESSION_ID,
    expectedWorkingProjectSha256: null,
    scenePlanId: "scene-1",
    manifestCompositionId: "comp-1",
    aeProjectItemIndex: 1,
    compositionName: "Test Comp",
    approvedMappingIds: ["ph-1", "ph-2"],
    operations: [OP_0, OP_1],
    checkpoint: null,
    ...overrides
  };
}

class FakeAeEditBridge implements AeEditBridge {
  calls: { aeProjectItemIndex: number; compositionName: string; operation: SceneEditOperation }[] = [];
  saveCalls = 0;
  openProjectCalls: string[] = [];
  private workingCopyPath: string | null = null;

  constructor(
    private readonly opResult: (operation: SceneEditOperation, callIndex: number) => OperationExecutionResult,
    private readonly saveResult: SaveProjectResult = { ok: true, resultingValue: null },
    /** Default: confirms whatever path the executor asked to open - real per-test coverage of a MISMATCHED/failed open lives in the dedicated "explicitly opens the session working copy" describe block below. */
    private readonly openResult: (expectedPath: string) => OpenProjectResult = (expectedPath) => ({ ok: true, openedPath: expectedPath })
  ) {}

  async openProject(expectedPath: string): Promise<OpenProjectResult> {
    this.openProjectCalls.push(expectedPath);
    this.workingCopyPath = expectedPath;
    return this.openResult(expectedPath);
  }

  async applyOperation({
    aeProjectItemIndex,
    compositionName,
    operation
  }: {
    aeProjectItemIndex: number;
    compositionName: string;
    operation: SceneEditOperation;
  }): Promise<OperationExecutionResult> {
    const callIndex = this.calls.length;
    this.calls.push({ aeProjectItemIndex, compositionName, operation });
    return this.opResult(operation, callIndex);
  }

  async saveProject(): Promise<SaveProjectResult> {
    this.saveCalls++;
    // Simulates a REAL mutation actually landing on disk - a real AE save
    // after real content changes always alters some bytes of the working
    // copy; this fake stays honest about that (rather than silently
    // leaving the file byte-identical) so the executor's own
    // WORKING_COPY_UNCHANGED_AFTER_MUTATION safety check exercises the
    // SAME real condition a genuine successful run would produce, not a
    // false positive from this fake's own laziness.
    if (this.saveResult.ok && this.calls.length > 0 && this.workingCopyPath) {
      try {
        appendFileSync(this.workingCopyPath, `\n// simulated edit #${this.calls.length}`);
      } catch {
        // Best-effort only - a test targeting a different failure mode
        // (e.g. save itself failing) never depends on this succeeding.
      }
    }
    return this.saveResult;
  }
}

class FakePreviewCapture implements PreviewCapture {
  calls = 0;
  constructor(private readonly result: PreviewCaptureResult) {}
  async capture(): Promise<PreviewCaptureResult> {
    this.calls++;
    return this.result;
  }
}

function alwaysSucceed(operation: SceneEditOperation): OperationExecutionResult {
  return { ok: true, operationType: operation.type, previousValue: null, resultingValue: null };
}

const REAL_PREVIEW: PreviewCaptureResult = { ok: true, path: "/work/preview.png", bytes: 1234, timestampSeconds: 0 };

describe("executeSceneEdit", () => {
  it("happy path: all operations apply, working copy saves, preview is captured and verified", async () => {
    const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
    const workRoot = join(root, "work-root");
    const bridge = new FakeAeEditBridge(alwaysSucceed);
    const preview = new FakePreviewCapture(REAL_PREVIEW);

    const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });
    // The real working copy path the executor will compute internally -
    // only used below to assert the RESULT reports it, never sent as part
    // of the request itself (the worker derives it, never the caller).
    const workingCopyPathModule = await import("../../workspace/working-copy.js");
    const workingProjectPath = workingCopyPathModule.sessionWorkingCopyPath(workRoot, EXECUTION_SESSION_ID);

    const result = await executeSceneEdit(
      { workRoot, aeEditBridge: bridge, previewCapture: preview, uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date("2026-01-01T00:00:00.000Z") },
      request
    );

    expect(result.failureReason).toBeNull();
    expect(result.operationsCompleted.sort()).toEqual([0, 1]);
    expect(result.previewFramePath).toBe("/work/preview.png");
    expect(result.previewTimestampSeconds).toBe(0);
    expect(result.workingProjectPath).toBe(workingProjectPath);
    expect(result.sourceProjectSha256).toBe(sourceSha);
    expect(bridge.calls).toHaveLength(2);
    expect(bridge.saveCalls).toBe(1);
    expect(preview.calls).toBe(1);

    // Source untouched throughout.
    expect(readFileSync(sourcePath, "utf8")).toBe("fake-aep-bytes");
  });

  it("captures reelsCompositionBuilt from a successful BUILD_REELS_COMPOSITION operation's own resultingValue - never fabricated", async () => {
    const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
    const workRoot = join(root, "work-root");
    const reelsOp: SceneEditOperationIntent = {
      type: "BUILD_REELS_COMPOSITION",
      reelsCompositionName: "Scene 01 - Reels",
      layerTransforms: [{ layerIndex: 2, manifestPlaceholderId: "ph-1", positionX: 540, positionY: 960, scalePercent: 150 }]
    };
    const bridge = new FakeAeEditBridge((operation) => ({
      ok: true,
      operationType: operation.type,
      previousValue: null,
      resultingValue:
        operation.type === "BUILD_REELS_COMPOSITION"
          ? { reelsAeProjectItemIndex: 9, reelsCompositionName: "Scene 01 - Reels", reelsWidthPx: 1080, reelsHeightPx: 1920, reelsDurationSeconds: 5, reelsFrameRate: 30 }
          : null
    }));
    const preview = new FakePreviewCapture(REAL_PREVIEW);
    const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha, operations: [reelsOp] });

    const result = await executeSceneEdit(
      { workRoot, aeEditBridge: bridge, previewCapture: preview, uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
      request
    );

    expect(result.failureReason).toBeNull();
    expect(result.reelsCompositionBuilt).toEqual({
      aeProjectItemIndex: 9,
      compositionName: "Scene 01 - Reels",
      widthPx: 1080,
      heightPx: 1920,
      durationSeconds: 5,
      frameRate: 30
    });
  });

  it("leaves reelsCompositionBuilt null for an ordinary run with no BUILD_REELS_COMPOSITION operation", async () => {
    const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
    const workRoot = join(root, "work-root");
    const bridge = new FakeAeEditBridge(alwaysSucceed);
    const preview = new FakePreviewCapture(REAL_PREVIEW);
    const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });

    const result = await executeSceneEdit(
      { workRoot, aeEditBridge: bridge, previewCapture: preview, uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
      request
    );

    expect(result.reelsCompositionBuilt).toBeNull();
  });

  it("does not fabricate reelsCompositionBuilt from a malformed/incomplete resultingValue", async () => {
    const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
    const workRoot = join(root, "work-root");
    const reelsOp: SceneEditOperationIntent = {
      type: "BUILD_REELS_COMPOSITION",
      reelsCompositionName: "Scene 01 - Reels",
      layerTransforms: [{ layerIndex: 2, manifestPlaceholderId: "ph-1", positionX: 540, positionY: 960, scalePercent: 150 }]
    };
    const bridge = new FakeAeEditBridge(() => ({
      ok: true,
      operationType: "BUILD_REELS_COMPOSITION",
      previousValue: null,
      resultingValue: { reelsAeProjectItemIndex: 9 } // missing every other required field
    }));
    const preview = new FakePreviewCapture(REAL_PREVIEW);
    const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha, operations: [reelsOp] });

    const result = await executeSceneEdit(
      { workRoot, aeEditBridge: bridge, previewCapture: preview, uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
      request
    );

    expect(result.reelsCompositionBuilt).toBeNull();
  });

  it("fails closed when the working copy cannot be prepared (source sha mismatch) - never touches the bridge at all", async () => {
    const { sourcePath, root } = makeSourceProject();
    const workRoot = join(root, "work-root");
    const bridge = new FakeAeEditBridge(alwaysSucceed);
    const preview = new FakePreviewCapture(REAL_PREVIEW);

    const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: "f".repeat(64) });

    const result = await executeSceneEdit({ workRoot, aeEditBridge: bridge, previewCapture: preview, uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() }, request);

    expect(result.failureReason).toContain("working copy could not be prepared");
    expect(result.workingProjectPath).toBeNull();
    expect(result.operationsCompleted).toEqual([]);
    expect(bridge.calls).toHaveLength(0);
    expect(preview.calls).toBe(0);
  });

  it("stops at the failing operation and reports a typed failure, without applying later operations", async () => {
    const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
    const workRoot = join(root, "work-root");
    const bridge = new FakeAeEditBridge((operation, callIndex) =>
      callIndex === 0 ? { ok: false, operationType: operation.type, failureReason: "layer not found" } : alwaysSucceed(operation)
    );
    const preview = new FakePreviewCapture(REAL_PREVIEW);

    const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });
    const result = await executeSceneEdit({ workRoot, aeEditBridge: bridge, previewCapture: preview, uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() }, request);

    expect(result.failureReason).toContain("layer not found");
    expect(result.operationsCompleted).toEqual([]);
    expect(bridge.calls).toHaveLength(1); // never reached operation 1
    expect(preview.calls).toBe(0);
  });

  it("resumes from a partial checkpoint - never reapplies an already-completed operation", async () => {
    const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
    const workRoot = join(root, "work-root");

    // First attempt: operation 1 fails.
    const firstBridge = new FakeAeEditBridge((operation, callIndex) =>
      callIndex === 1 ? { ok: false, operationType: operation.type, failureReason: "transient AE error" } : alwaysSucceed(operation)
    );
    const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });
    const firstResult = await executeSceneEdit(
      { workRoot, aeEditBridge: firstBridge, previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
      request
    );
    expect(firstResult.operationsCompleted).toEqual([0]);
    expect(firstBridge.calls).toHaveLength(2); // tried op 0 (succeeded) and op 1 (failed)

    // Second attempt: resumes using the checkpoint from the first attempt.
    const secondBridge = new FakeAeEditBridge(alwaysSucceed);
    const secondPreview = new FakePreviewCapture(REAL_PREVIEW);
    const secondResult = await executeSceneEdit(
      { workRoot, aeEditBridge: secondBridge, previewCapture: secondPreview, uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
      { ...request, checkpoint: firstResult.checkpoint }
    );

    expect(secondResult.operationsCompleted.sort()).toEqual([0, 1]);
    expect(secondResult.failureReason).toBeNull();
    // Only operation 1 was retried - operation 0 was never reapplied.
    expect(secondBridge.calls).toHaveLength(1);
    expect(secondBridge.calls[0]?.operation).toEqual(OP_1);
  });

  it("a duplicate invocation of an already-fully-completed job never re-applies any operation", async () => {
    const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
    const workRoot = join(root, "work-root");
    const completedCheckpoint = {
      completedOperationIndices: [0, 1],
      checkpointBeforeAt: "2026-01-01T00:00:00.000Z",
      checkpointAfterAt: "2026-01-01T00:00:01.000Z",
      failureReason: null
    };
    const request = makeRequest({
      sourceProjectPath: sourcePath,
      sourceProjectSha256: sourceSha,
      checkpoint: completedCheckpoint
    });

    const bridge = new FakeAeEditBridge(alwaysSucceed);
    const result = await executeSceneEdit(
      { workRoot, aeEditBridge: bridge, previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
      request
    );

    expect(bridge.calls).toHaveLength(0); // no operation re-applied
    expect(result.operationsCompleted.sort()).toEqual([0, 1]);
    expect(result.failureReason).toBeNull();
  });

  it("preview capture failure is reported even though every operation and the save both succeeded", async () => {
    const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
    const workRoot = join(root, "work-root");

    const bridge = new FakeAeEditBridge(alwaysSucceed);
    const preview = new FakePreviewCapture({ ok: false, reason: "captured preview file exists but is empty or not a regular file" });
    const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });

    const result = await executeSceneEdit({ workRoot, aeEditBridge: bridge, previewCapture: preview, uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() }, request);

    expect(result.operationsCompleted.sort()).toEqual([0, 1]); // all operations DID complete
    expect(result.previewFramePath).toBeNull();
    expect(result.failureReason).toContain("preview capture failed");
    expect(bridge.saveCalls).toBe(1); // save still happened before preview was attempted
  });

  it("multi-scene-accumulation section 3: a captured preview that fails to UPLOAD is never reported as an acceptable result - the bytes must actually reach the API, a local-only capture is not enough", async () => {
    const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
    const workRoot = join(root, "work-root");

    const bridge = new FakeAeEditBridge(alwaysSucceed);
    const preview = new FakePreviewCapture(REAL_PREVIEW);
    const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });

    const result = await executeSceneEdit(
      {
        workRoot,
        aeEditBridge: bridge,
        previewCapture: preview,
        uploadPreview: async () => ({ ok: false, reason: "network error reaching the API" }),
        persistCheckpoint: async () => ({ ok: true as const }),
        resolveOperation: defaultResolveOperation,
        now: () => new Date()
      },
      request
    );

    expect(result.operationsCompleted.sort()).toEqual([0, 1]); // all operations DID complete and save happened
    expect(result.previewFramePath).toBeNull();
    expect(result.failureReason).toContain("upload failed");
    expect(result.failureReason).toContain("network error reaching the API");
    expect(preview.calls).toBe(1); // capture itself succeeded - only the upload failed
  });

  it("a save failure is reported and never produces a preview", async () => {
    const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
    const workRoot = join(root, "work-root");

    const bridge = new FakeAeEditBridge(alwaysSucceed, { ok: false, failureReason: "disk full" });
    const preview = new FakePreviewCapture(REAL_PREVIEW);
    const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });

    const result = await executeSceneEdit({ workRoot, aeEditBridge: bridge, previewCapture: preview, uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() }, request);

    expect(result.failureReason).toContain("working copy save failed");
    expect(result.previewFramePath).toBeNull();
    expect(preview.calls).toBe(0);
  });

  it("never touches the original source file, even across a full successful run", async () => {
    const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
    const workRoot = join(root, "work-root");
    const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });

    await executeSceneEdit(
      { workRoot, aeEditBridge: new FakeAeEditBridge(alwaysSucceed), previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
      request
    );

    expect(readFileSync(sourcePath, "utf8")).toBe("fake-aep-bytes");
    expect(sha256(readFileSync(sourcePath, "utf8"))).toBe(sourceSha);
  });

  describe("durable mid-job checkpoint persistence", () => {
    it("persists a checkpoint after EACH operation, before the next one is attempted", async () => {
      const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
      const workRoot = join(root, "work-root");
      const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });

      const persistedCheckpoints: number[][] = [];
      const bridge = new FakeAeEditBridge(alwaysSucceed);
      const persistCheckpoint = vi.fn(async (checkpoint: { completedOperationIndices: number[] }) => {
        persistedCheckpoints.push([...checkpoint.completedOperationIndices].sort((a, b) => a - b));
        return { ok: true as const };
      });

      const result = await executeSceneEdit(
        { workRoot, aeEditBridge: bridge, previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint, resolveOperation: defaultResolveOperation, now: () => new Date() },
        request
      );

      expect(result.failureReason).toBeNull();
      // One persist call per operation, each carrying the checkpoint AS OF
      // that operation completing - never batched/deferred to the end.
      expect(persistedCheckpoints).toEqual([[0], [0, 1]]);
      expect(persistCheckpoint).toHaveBeenCalledTimes(2);
    });

    it("pauses (does not apply further operations) when checkpoint persistence fails after an operation completes", async () => {
      const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
      const workRoot = join(root, "work-root");
      const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });

      const bridge = new FakeAeEditBridge(alwaysSucceed);
      const persistCheckpoint = vi.fn(async () => ({ ok: false as const, reason: "network error reaching the API" }));

      const result = await executeSceneEdit(
        { workRoot, aeEditBridge: bridge, previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint, resolveOperation: defaultResolveOperation, now: () => new Date() },
        request
      );

      // Operation 0 itself DID complete against the bridge (verified) -
      // only operation 1 was never attempted, because durable checkpoint
      // state became unknown right after operation 0.
      expect(bridge.calls).toHaveLength(1);
      expect(persistCheckpoint).toHaveBeenCalledTimes(1);
      expect(result.failureReason).toContain("checkpoint persistence failed");
      expect(result.failureReason).toContain("network error reaching the API");
      // The in-memory checkpoint still carries operation 0 as completed -
      // a subsequent job attempt with this checkpoint must not re-run it.
      expect(result.checkpoint.completedOperationIndices).toEqual([0]);
      expect(result.operationsCompleted).toEqual([0]);
    });

    it("crash/resume: operation 0 succeeds and its checkpoint is durably persisted, then the process 'dies' before op 1's checkpoint ever durably lands - a retry starting from the LAST DURABLY-PERSISTED checkpoint (not the crashed process's own in-memory state) skips op 0 and only re-attempts op 1", async () => {
      const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
      const workRoot = join(root, "work-root");
      const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });

      // A stand-in for the API's own durable checkpoint record - only
      // updated when a persistCheckpoint call actually succeeds. Op 1's
      // call deliberately fails here (simulating the worker process dying
      // before the API ever confirmed it - a real crash never returns at
      // all, which behaves identically from the executor's point of view:
      // it never gets an { ok: true } back).
      const durable: { checkpoint: SceneEditCheckpoint | null } = { checkpoint: null };
      const firstBridge = new FakeAeEditBridge(alwaysSucceed);
      let persistCall = 0;
      const firstPersist = vi.fn(async (cp: SceneEditCheckpoint) => {
        persistCall++;
        if (persistCall === 1) {
          durable.checkpoint = cp;
          return { ok: true as const };
        }
        return { ok: false as const, reason: "process died before this checkpoint was confirmed durable" };
      });
      const firstResult = await executeSceneEdit(
        { workRoot, aeEditBridge: firstBridge, previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: firstPersist, resolveOperation: defaultResolveOperation, now: () => new Date() },
        request
      );
      expect(firstResult.failureReason).toContain("checkpoint persistence failed");
      expect(firstBridge.calls).toHaveLength(2); // op 0 and op 1 both ran against the bridge...
      // ...but only op 0's checkpoint durably landed - the retry must use THAT, not firstResult's own (unreliable, crashed-process) in-memory checkpoint.
      expect(durable.checkpoint?.completedOperationIndices).toEqual([0]);

      // Second attempt ("retry"): starts from the LAST DURABLY-PERSISTED
      // checkpoint (what a real caller would load from the API), not from
      // firstResult.checkpoint.
      const secondBridge = new FakeAeEditBridge(alwaysSucceed);
      const secondPersist = vi.fn(async () => ({ ok: true as const }));
      const secondResult = await executeSceneEdit(
        {
          workRoot,
          aeEditBridge: secondBridge,
          previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }),
          persistCheckpoint: secondPersist,
          resolveOperation: defaultResolveOperation,
          now: () => new Date()
        },
        { ...request, checkpoint: durable.checkpoint }
      );

      expect(secondResult.failureReason).toBeNull();
      expect(secondResult.operationsCompleted.sort()).toEqual([0, 1]);
      // Op 0 was never reapplied - only op 1 (the one whose checkpoint was lost) ran again.
      expect(secondBridge.calls).toHaveLength(1);
      expect(secondBridge.calls[0]?.operation).toEqual(OP_1);
    });

    it("a duplicate persistCheckpoint call for an already-persisted checkpoint is harmless (idempotent from the executor's perspective - it never inspects the persisted response's content)", async () => {
      const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
      const workRoot = join(root, "work-root");
      const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });

      const bridge = new FakeAeEditBridge(alwaysSucceed);
      // Always reports ok:true regardless of how many times it's called
      // with the same or a growing checkpoint - mirrors the real API's own
      // monotonic-superset-or-equal acceptance rule.
      const persistCheckpoint = vi.fn(async () => ({ ok: true as const }));

      const result = await executeSceneEdit(
        { workRoot, aeEditBridge: bridge, previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint, resolveOperation: defaultResolveOperation, now: () => new Date() },
        request
      );

      expect(result.failureReason).toBeNull();
      expect(persistCheckpoint).toHaveBeenCalledTimes(2);
    });
  });

  describe("session-scoped working-copy accumulation (multi-scene-accumulation phase)", () => {
    it("a second scene's job in the SAME session continues from the first scene's own edited working copy, never a fresh copy from source", async () => {
      const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
      const workRoot = join(root, "work-root");

      const scene1Request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha, scenePlanId: "scene-1" });
      const scene1Result = await executeSceneEdit(
        { workRoot, aeEditBridge: new FakeAeEditBridge(alwaysSucceed), previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
        scene1Request
      );
      expect(scene1Result.failureReason).toBeNull();
      expect(scene1Result.executionSessionId).toBe(EXECUTION_SESSION_ID);
      expect(scene1Result.workingProjectSha256).not.toBeNull();

      // Scene 2's request asserts the exact sha256 scene 1's own edit
      // produced - the real chain-of-custody value the API would have
      // durably recorded and handed back for this next dispatch.
      const scene2Request = makeRequest({
        sourceProjectPath: sourcePath,
        sourceProjectSha256: sourceSha,
        scenePlanId: "scene-2",
        expectedWorkingProjectSha256: scene1Result.workingProjectSha256
      });
      const scene2Bridge = new FakeAeEditBridge(alwaysSucceed);
      const scene2Result = await executeSceneEdit(
        { workRoot, aeEditBridge: scene2Bridge, previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
        scene2Request
      );

      expect(scene2Result.failureReason).toBeNull();
      // Same file on disk - scene 2 edited the SAME working copy scene 1 produced.
      expect(scene2Result.workingProjectPath).toBe(scene1Result.workingProjectPath);
      expect(scene2Bridge.calls).toHaveLength(2);
    });

    it("fails closed with workingCopyFailureCode WORKING_COPY_MISSING when a later scene job's session has no working copy on disk", async () => {
      const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
      const workRoot = join(root, "work-root");
      const request = makeRequest({
        sourceProjectPath: sourcePath,
        sourceProjectSha256: sourceSha,
        expectedWorkingProjectSha256: "d".repeat(64) // claims a prior scene succeeded, but nothing was ever created
      });

      const result = await executeSceneEdit(
        { workRoot, aeEditBridge: new FakeAeEditBridge(alwaysSucceed), previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
        request
      );

      expect(result.failureReason).toContain("WORKING_COPY_MISSING");
      expect(result.workingCopyFailureCode).toBe("WORKING_COPY_MISSING");
      expect(result.workingProjectPath).toBeNull();
    });

    it("fails closed with workingCopyFailureCode WORKING_COPY_SHA_MISMATCH when the on-disk working copy disagrees with what this session expects, and never falls back to an ordinary failure code", async () => {
      const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
      const workRoot = join(root, "work-root");

      const scene1Request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });
      const scene1Result = await executeSceneEdit(
        { workRoot, aeEditBridge: new FakeAeEditBridge(alwaysSucceed), previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
        scene1Request
      );
      expect(scene1Result.failureReason).toBeNull();

      const scene2Request = makeRequest({
        sourceProjectPath: sourcePath,
        sourceProjectSha256: sourceSha,
        expectedWorkingProjectSha256: "e".repeat(64) // disagrees with the real on-disk sha256
      });
      const result = await executeSceneEdit(
        { workRoot, aeEditBridge: new FakeAeEditBridge(alwaysSucceed), previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
        scene2Request
      );

      expect(result.workingCopyFailureCode).toBe("WORKING_COPY_SHA_MISMATCH");
    });

    it("an ordinary failure (e.g. source sha mismatch) never sets workingCopyFailureCode - only a real chain-of-custody divergence does", async () => {
      const { sourcePath, root } = makeSourceProject();
      const workRoot = join(root, "work-root");
      const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: "f".repeat(64) });

      const result = await executeSceneEdit(
        { workRoot, aeEditBridge: new FakeAeEditBridge(alwaysSucceed), previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
        request
      );

      expect(result.failureReason).toContain("working copy could not be prepared");
      expect(result.workingCopyFailureCode).toBeNull();
    });
  });

  describe("CRITICAL SAFETY FIX (live QA, 2026-09-08 real incident): EXECUTE_FRAME explicitly opens the session working copy, and independently re-verifies source immutability", () => {
    it("calls openProject with the EXACT real working-copy path, before applying any operation", async () => {
      const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
      const workRoot = join(root, "work-root");
      const bridge = new FakeAeEditBridge(alwaysSucceed);
      const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });
      const { sessionWorkingCopyPath } = await import("../../workspace/working-copy.js");
      const expectedWorkingCopyPath = sessionWorkingCopyPath(workRoot, EXECUTION_SESSION_ID);

      const result = await executeSceneEdit(
        { workRoot, aeEditBridge: bridge, previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
        request
      );

      expect(result.failureReason).toBeNull();
      expect(bridge.openProjectCalls).toEqual([expectedWorkingCopyPath]);
      // The working copy is never the source path - explicit, canonical proof, not just "they're different strings".
      expect(expectedWorkingCopyPath).not.toBe(sourcePath);
    });

    it("wrong/open project path fails BEFORE any SET_TEXT/MAP_FOOTAGE operation is attempted - never mutates whatever AE actually has open", async () => {
      const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
      const workRoot = join(root, "work-root");
      // Simulates the exact real incident: AE reports the IMMUTABLE SOURCE
      // itself is open (left open by an earlier, unrelated job), not the
      // session's own working copy.
      const bridge = new FakeAeEditBridge(alwaysSucceed, { ok: true, resultingValue: null }, () => ({ ok: false, failureReason: `AE reports "${sourcePath}" is open, not the requested working copy` }));
      const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });

      const result = await executeSceneEdit(
        { workRoot, aeEditBridge: bridge, previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
        request
      );

      expect(result.failureReason).toContain("could not confirm the session working copy is open");
      expect(result.workingCopyFailureCode).toBe("WORKING_COPY_NOT_OPENED");
      expect(bridge.calls).toHaveLength(0); // no SET_TEXT/MAP_FOOTAGE/etc. was ever attempted
      expect(bridge.saveCalls).toBe(0); // and definitely never saved
      // Source untouched - the whole point of failing closed here.
      expect(readFileSync(sourcePath, "utf8")).toBe("fake-aep-bytes");
    });

    it("fails closed (WORKING_COPY_NOT_OPENED) when the open-project script itself reports failure (e.g. app.open() threw)", async () => {
      const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
      const workRoot = join(root, "work-root");
      const bridge = new FakeAeEditBridge(alwaysSucceed, { ok: true, resultingValue: null }, () => ({ ok: false, failureReason: "open failed: file is locked" }));
      const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });

      const result = await executeSceneEdit(
        { workRoot, aeEditBridge: bridge, previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
        request
      );

      expect(result.workingCopyFailureCode).toBe("WORKING_COPY_NOT_OPENED");
      expect(result.failureReason).toContain("file is locked");
      expect(bridge.calls).toHaveLength(0);
    });

    it("SOURCE_PROJECT_MUTATED: fails hard, never captures or uploads a preview, when the immutable source's real bytes changed during this job's own execution", async () => {
      const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
      const workRoot = join(root, "work-root");
      const preview = new FakePreviewCapture(REAL_PREVIEW);
      // A bridge whose own saveProject reaches past the working copy and
      // corrupts the SOURCE file too - simulating the exact real incident
      // (AE had the source open and saved over it) at the level this
      // safety check is actually meant to catch: not HOW the source got
      // mutated, but THAT it did, independently re-verified from disk.
      const bridge = new FakeAeEditBridge(alwaysSucceed);
      const originalSave = bridge.saveProject.bind(bridge);
      bridge.saveProject = async () => {
        writeFileSync(sourcePath, "CORRUPTED - source was overwritten");
        return originalSave();
      };
      const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });

      const result = await executeSceneEdit(
        { workRoot, aeEditBridge: bridge, previewCapture: preview, uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
        request
      );

      expect(result.workingCopyFailureCode).toBe("SOURCE_PROJECT_MUTATED");
      expect(result.failureReason).toContain("SOURCE_PROJECT_MUTATED");
      expect(result.failureReason).toContain("CRITICAL SAFETY VIOLATION");
      expect(result.previewFramePath).toBeNull();
      expect(preview.calls).toBe(0); // never even attempted once the violation was detected
    });

    it("working copy's own sha256 genuinely CHANGES after a real mutation, and the job reports that real, freshly-computed value - never the pre-operation one", async () => {
      const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
      const workRoot = join(root, "work-root");
      const bridge = new FakeAeEditBridge(alwaysSucceed);
      const { sessionWorkingCopyPath } = await import("../../workspace/working-copy.js");
      const workingCopyPath = sessionWorkingCopyPath(workRoot, EXECUTION_SESSION_ID);
      const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });

      const result = await executeSceneEdit(
        { workRoot, aeEditBridge: bridge, previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
        request
      );

      expect(result.failureReason).toBeNull();
      const realFileHash = sha256(readFileSync(workingCopyPath, "utf8"));
      expect(result.workingProjectSha256).toBe(realFileHash);
      // Genuinely different from the pre-operation copy (a fresh copy of the untouched source).
      expect(result.workingProjectSha256).not.toBe(sourceSha);
    });

    it("WORKING_COPY_UNCHANGED_AFTER_MUTATION: fails closed when operations report success but the saved working copy's bytes never actually changed", async () => {
      const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
      const workRoot = join(root, "work-root");
      const preview = new FakePreviewCapture(REAL_PREVIEW);
      // A bridge that reports every operation ok:true and saveProject
      // ok:true, but (unlike the honest FakeAeEditBridge default) never
      // actually writes anything - the exact "reports success but nothing
      // was really persisted" symptom this check exists to catch.
      const dishonestBridge: AeEditBridge = {
        async openProject(expectedPath: string) {
          return { ok: true, openedPath: expectedPath };
        },
        async applyOperation({ operation }) {
          return { ok: true, operationType: operation.type, previousValue: null, resultingValue: null };
        },
        async saveProject() {
          return { ok: true, resultingValue: null };
        }
      };
      const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha });

      const result = await executeSceneEdit(
        { workRoot, aeEditBridge: dishonestBridge, previewCapture: preview, uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
        request
      );

      expect(result.workingCopyFailureCode).toBe("WORKING_COPY_UNCHANGED_AFTER_MUTATION");
      expect(result.failureReason).toContain("WORKING_COPY_UNCHANGED_AFTER_MUTATION");
      expect(result.previewFramePath).toBeNull();
      expect(preview.calls).toBe(0);
    });

    it("a duplicate/already-fully-completed job (zero operations applied THIS run) is exempt from WORKING_COPY_UNCHANGED_AFTER_MUTATION - a legitimate no-op resume, never suspicious", async () => {
      const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
      const workRoot = join(root, "work-root");
      const completedCheckpoint = {
        completedOperationIndices: [0, 1],
        checkpointBeforeAt: "2026-01-01T00:00:00.000Z",
        checkpointAfterAt: "2026-01-01T00:00:01.000Z",
        failureReason: null
      };
      // A bridge whose saveProject never writes anything - legitimate here,
      // since zero operations are pending (both already completed per the
      // checkpoint above), so no new mutation was ever expected this run.
      const bridge = new FakeAeEditBridge(alwaysSucceed);
      const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha, checkpoint: completedCheckpoint });

      const result = await executeSceneEdit(
        { workRoot, aeEditBridge: bridge, previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
        request
      );

      expect(bridge.calls).toHaveLength(0);
      expect(result.workingCopyFailureCode).toBeNull();
      expect(result.failureReason).toBeNull();
    });

    it("nested logo MAP_FOOTAGE and nested Hebrew SET_TEXT operations both still succeed end-to-end through the full executor, with openProject correctly called first", async () => {
      const { sourcePath, root, sha256: sourceSha } = makeSourceProject();
      const workRoot = join(root, "work-root");
      const nestedLogoOp: SceneEditOperationIntent = {
        type: "MAP_FOOTAGE",
        manifestPlaceholderId: null,
        layerIndex: null,
        nestedTarget: [
          { compositionId: "comp-1", aeProjectItemIndex: 48, layerIndex: 3 },
          { compositionId: "comp-1635", aeProjectItemIndex: 45, layerIndex: 1 }
        ],
        assetId: "22222222-2222-2222-2222-222222222222",
        expectedSha256: "b".repeat(64),
        mimeType: "image/png"
      };
      const nestedTextOp: SceneEditOperationIntent = {
        type: "SET_TEXT",
        manifestPlaceholderId: null,
        layerIndex: null,
        nestedTarget: [
          { compositionId: "comp-1", aeProjectItemIndex: 48, layerIndex: 3 },
          { compositionId: "comp-1635", aeProjectItemIndex: 45, layerIndex: 4 }
        ],
        text: "מבית DYO App"
      };
      const bridge = new FakeAeEditBridge(alwaysSucceed);
      const request = makeRequest({ sourceProjectPath: sourcePath, sourceProjectSha256: sourceSha, operations: [nestedLogoOp, nestedTextOp] });

      const result = await executeSceneEdit(
        { workRoot, aeEditBridge: bridge, previewCapture: new FakePreviewCapture(REAL_PREVIEW), uploadPreview: async () => ({ ok: true as const }), persistCheckpoint: async () => ({ ok: true as const }), resolveOperation: defaultResolveOperation, now: () => new Date() },
        request
      );

      expect(result.failureReason).toBeNull();
      expect(result.operationsCompleted.sort()).toEqual([0, 1]);
      expect(bridge.openProjectCalls).toHaveLength(1); // opened exactly once, before either operation
      expect(bridge.calls[0]?.operation.type).toBe("MAP_FOOTAGE");
      expect(bridge.calls[1]?.operation.type).toBe("SET_TEXT");
      expect(result.workingCopyFailureCode).toBeNull();
    });
  });
});
