import { z } from "zod";
import type { ExecuteSceneEditRequest, SceneEditCheckpoint, SceneEditOperationIntent, SceneEditResult, WorkingCopyFailureCode } from "@dyo/schemas";
import { prepareSessionWorkingCopy, type WorkingCopyFailureReason } from "../workspace/working-copy.js";
import { hashSourceProject } from "../inspection/hash-source-project.js";
import { EMPTY_SCENE_EDIT_CHECKPOINT, markFailed, markOperationCompleted, nextPendingOperationIndex } from "./scene-edit-checkpoint.js";
import type { AeEditBridge } from "./ae-edit-bridge.js";
import type { PreviewCapture } from "./preview-capture.js";
import type { UploadPreviewResult } from "./upload-preview.js";
import type { ResolveSceneEditOperationResult } from "./resolve-scene-edit-operation.js";

/** What jsx-templates.ts's BUILD_REELS_COMPOSITION script's own resultingValue actually contains - parsed defensively, never trusted blindly. */
const reelsCompositionBuiltResultSchema = z.object({
  reelsAeProjectItemIndex: z.number().int().positive(),
  reelsCompositionName: z.string().min(1),
  reelsWidthPx: z.number().int().positive(),
  reelsHeightPx: z.number().int().positive(),
  reelsDurationSeconds: z.number().nonnegative(),
  reelsFrameRate: z.number().positive()
});

/**
 * The one fixed frame this project's own "first-frame execution" workflow
 * (CLAUDE.md Required Workflow step 9) captures for EXECUTE_FRAME's
 * preview - always t=0, never configurable/guessed (section 13: "a
 * controlled frame time").
 */
const PREVIEW_TIMESTAMP_SECONDS = 0;

/**
 * Durable mid-job progress report - see apps/api's report-job-checkpoint.ts
 * for the endpoint this is expected to hit. `ok: false` means the durable
 * checkpoint state is now UNKNOWN (network failure, rejected as stale/
 * regressed/no-longer-RUNNING, etc.) - the executor's own contract is to
 * stop applying further mutations in that case rather than guess.
 */
export type PersistCheckpoint = (checkpoint: SceneEditCheckpoint) => Promise<{ ok: true } | { ok: false; reason: string }>;

/** Resolves one dispatch-facing operation intent into the real, resolved operation ae-edit-bridge.ts expects - see resolve-scene-edit-operation.ts. Called lazily, once per still-pending operation, never for the whole array up front (an asset download only ever happens for the operation about to actually run). */
export type ResolveOperation = (intent: SceneEditOperationIntent) => Promise<ResolveSceneEditOperationResult>;

export interface SceneEditExecutorDeps {
  workRoot: string;
  aeEditBridge: AeEditBridge;
  previewCapture: PreviewCapture;
  /**
   * Multi-scene-accumulation phase, section 3: the real byte transfer that
   * makes a captured preview visible in the dashboard - never merely a
   * local path. Pre-bound to THIS job's own jobId by job-dispatcher.ts
   * (this executor is not itself handed job/worker identity, same
   * convention as ResolveOperation's own closure).
   */
  uploadPreview: (filePath: string) => Promise<UploadPreviewResult>;
  persistCheckpoint: PersistCheckpoint;
  resolveOperation: ResolveOperation;
  now: () => Date;
}

/**
 * The full EXECUTE_FRAME pipeline: verify/prepare a working copy, resume
 * from any prior checkpoint, apply each still-pending operation through
 * the fixed AE edit bridge, save the working copy, capture and verify a
 * real preview frame. Never partially mutates and then reports success -
 * every early return already has a `failureReason` set and (per
 * isSceneEditResultAcceptable, apps/api's own acceptance predicate) can
 * never be treated as complete.
 *
 * On any recoverable failure this returns rather than throwing, carrying
 * forward whatever operations already genuinely completed in
 * `checkpoint` - a subsequent job attempt with this same checkpoint
 * resumes from exactly where this one stopped, never from operation 0
 * (see scene-edit-checkpoint.ts).
 *
 * A worker process crash in the middle of this function's own operation
 * loop is now covered too: after EACH operation completes, its checkpoint
 * is durably persisted via `deps.persistCheckpoint` (a dedicated MID-JOB
 * progress report - see PersistCheckpoint's doc comment - deliberately
 * NEVER a job status transition) before the next operation is ever
 * attempted. If that crash happens before the next persistCheckpoint call
 * lands, the durable state still reflects every operation that completed
 * AND was confirmed persisted; a fresh job attempt loads that same
 * checkpoint (via `request.checkpoint`) and resumes from the next
 * incomplete operation, never re-running an already-completed one.
 */
/** Maps working-copy.ts's own failure-reason vocabulary onto the strict, API-facing chain-of-custody subset (section 7) - every OTHER reason (SAME_PATH/SOURCE_NOT_FOUND/SOURCE_SHA_MISMATCH/COPY_FAILED/WORKING_COPY_INVALID) is a real but ordinary failure, reported via failureReason text only, never mistaken for a chain-of-custody divergence. */
function toWorkingCopyFailureCode(reason: WorkingCopyFailureReason): WorkingCopyFailureCode | null {
  if (reason === "WORKING_COPY_MISSING" || reason === "WORKING_COPY_SHA_MISMATCH") {
    return reason;
  }
  return null;
}

export async function executeSceneEdit(deps: SceneEditExecutorDeps, request: ExecuteSceneEditRequest): Promise<SceneEditResult> {
  const startedAt = deps.now().toISOString();
  let checkpoint: SceneEditCheckpoint = request.checkpoint ?? EMPTY_SCENE_EDIT_CHECKPOINT;
  // Set only if a BUILD_REELS_COMPOSITION operation completes successfully
  // in this attempt - see jsx-templates.ts's own resultingValue shape for
  // that operation.
  let reelsCompositionBuilt: SceneEditResult["reelsCompositionBuilt"] = null;

  function finish(params: {
    sourceProjectSha256: string;
    workingProjectPath: string | null;
    workingProjectSha256: string | null;
    previewFramePath: string | null;
    previewTimestampSeconds: number | null;
    workingCopyFailureCode?: WorkingCopyFailureCode | null;
  }): SceneEditResult {
    return {
      executionSessionId: request.executionSessionId,
      scenePlanId: request.scenePlanId,
      sourceProjectSha256: params.sourceProjectSha256,
      workingProjectPath: params.workingProjectPath,
      workingProjectSha256: params.workingProjectSha256,
      workingCopyFailureCode: params.workingCopyFailureCode ?? null,
      operationsRequested: request.operations.length,
      operationsCompleted: [...checkpoint.completedOperationIndices].sort((a, b) => a - b),
      checkpoint,
      previewFramePath: params.previewFramePath,
      previewTimestampSeconds: params.previewTimestampSeconds,
      reelsCompositionBuilt,
      failureReason: checkpoint.failureReason,
      startedAt,
      completedAt: deps.now().toISOString()
    };
  }

  const workingCopy = await prepareSessionWorkingCopy({
    workRoot: deps.workRoot,
    executionSessionId: request.executionSessionId,
    sourceProjectPath: request.sourceProjectPath,
    expectedSourceSha256: request.sourceProjectSha256,
    expectedWorkingProjectSha256: request.expectedWorkingProjectSha256
  });
  if (!workingCopy.ok) {
    checkpoint = markFailed(checkpoint, `working copy could not be prepared (${workingCopy.reason}): ${workingCopy.message}`, deps.now());
    return finish({
      sourceProjectSha256: request.sourceProjectSha256,
      workingProjectPath: null,
      workingProjectSha256: null,
      previewFramePath: null,
      previewTimestampSeconds: null,
      workingCopyFailureCode: toWorkingCopyFailureCode(workingCopy.reason)
    });
  }

  let pendingIndex = nextPendingOperationIndex(checkpoint, request.operations.length);
  while (pendingIndex !== null) {
    const intent = request.operations[pendingIndex];
    if (!intent) {
      checkpoint = markFailed(checkpoint, `internal error: no operation exists at index ${pendingIndex}`, deps.now());
      return finish({
        sourceProjectSha256: workingCopy.sourceProjectSha256,
        workingProjectPath: workingCopy.workingProjectPath,
        workingProjectSha256: workingCopy.workingProjectSha256,
        previewFramePath: null,
        previewTimestampSeconds: null
      });
    }

    checkpoint = { ...checkpoint, checkpointBeforeAt: deps.now().toISOString() };

    // Resolved lazily, right before this exact operation runs - a
    // MAP_FOOTAGE intent's asset download/verification only ever happens
    // for the operation about to actually be applied, never speculatively
    // for the whole array up front (see resolve-scene-edit-operation.ts).
    const resolved = await deps.resolveOperation(intent);
    if (!resolved.ok) {
      checkpoint = markFailed(checkpoint, `operation ${pendingIndex} (${intent.type}) could not be resolved: ${resolved.reason}`, deps.now());
      return finish({
        sourceProjectSha256: workingCopy.sourceProjectSha256,
        workingProjectPath: workingCopy.workingProjectPath,
        workingProjectSha256: workingCopy.workingProjectSha256,
        previewFramePath: null,
        previewTimestampSeconds: null
      });
    }
    const operation = resolved.operation;

    const outcome = await deps.aeEditBridge.applyOperation({
      aeProjectItemIndex: request.aeProjectItemIndex,
      compositionName: request.compositionName,
      operation
    });
    if (!outcome.ok) {
      checkpoint = markFailed(checkpoint, `operation ${pendingIndex} (${operation.type}) failed: ${outcome.failureReason}`, deps.now());
      return finish({
        sourceProjectSha256: workingCopy.sourceProjectSha256,
        workingProjectPath: workingCopy.workingProjectPath,
        workingProjectSha256: workingCopy.workingProjectSha256,
        previewFramePath: null,
        previewTimestampSeconds: null
      });
    }

    // Never report an operation complete before its result is verified -
    // `outcome.ok` above already IS that verification (the AE-side script
    // itself only ever reports ok:true after its mutation actually ran).
    checkpoint = markOperationCompleted(checkpoint, pendingIndex, deps.now());

    if (operation.type === "BUILD_REELS_COMPOSITION") {
      // outcome.resultingValue is `unknown` at this generic layer (every
      // operation shares OperationExecutionSuccess's own shape) - parsed
      // defensively via a strict schema, never trusted blindly, matching
      // this file's existing "typed failure over silent guess" convention.
      const parsedResultingValue = reelsCompositionBuiltResultSchema.safeParse(outcome.resultingValue);
      if (parsedResultingValue.success) {
        reelsCompositionBuilt = {
          aeProjectItemIndex: parsedResultingValue.data.reelsAeProjectItemIndex,
          compositionName: parsedResultingValue.data.reelsCompositionName,
          widthPx: parsedResultingValue.data.reelsWidthPx,
          heightPx: parsedResultingValue.data.reelsHeightPx,
          durationSeconds: parsedResultingValue.data.reelsDurationSeconds,
          frameRate: parsedResultingValue.data.reelsFrameRate
        };
      }
    }

    // Durably persist BEFORE continuing to the next operation - a worker
    // crash between this line and the job's own final report must not
    // silently lose a completed operation (see PersistCheckpoint's doc
    // comment). If persistence fails, the durable checkpoint state is
    // unknown, so this stops rather than applying further AE mutations -
    // the in-memory checkpoint above still carries this operation as
    // completed, so a later report of this job's own final result (via the
    // normal, separate reportJobStatus path) still reflects real progress.
    const persisted = await deps.persistCheckpoint(checkpoint);
    if (!persisted.ok) {
      checkpoint = markFailed(
        checkpoint,
        `checkpoint persistence failed after operation ${pendingIndex} (${operation.type}) completed: ${persisted.reason} - pausing rather than continuing with unknown durable checkpoint state`,
        deps.now()
      );
      return finish({
        sourceProjectSha256: workingCopy.sourceProjectSha256,
        workingProjectPath: workingCopy.workingProjectPath,
        workingProjectSha256: workingCopy.workingProjectSha256,
        previewFramePath: null,
        previewTimestampSeconds: null
      });
    }

    pendingIndex = nextPendingOperationIndex(checkpoint, request.operations.length);
  }

  const saveResult = await deps.aeEditBridge.saveProject();
  if (!saveResult.ok) {
    checkpoint = markFailed(checkpoint, `working copy save failed: ${saveResult.failureReason}`, deps.now());
    return finish({
      sourceProjectSha256: workingCopy.sourceProjectSha256,
      workingProjectPath: workingCopy.workingProjectPath,
      workingProjectSha256: workingCopy.workingProjectSha256,
      previewFramePath: null,
      previewTimestampSeconds: null
    });
  }

  // Section 12: verify the SAVED working copy for real - exists, real
  // file, non-zero size, and record its resulting sha256 (never assume
  // the save succeeded just because saveProject() didn't error).
  const savedHash = await hashSourceProject(workingCopy.workingProjectPath);
  if (!savedHash.ok) {
    checkpoint = markFailed(checkpoint, `could not verify the saved working copy on disk: ${savedHash.reason}`, deps.now());
    return finish({
      sourceProjectSha256: workingCopy.sourceProjectSha256,
      workingProjectPath: workingCopy.workingProjectPath,
      workingProjectSha256: workingCopy.workingProjectSha256,
      previewFramePath: null,
      previewTimestampSeconds: null
    });
  }

  const previewResult = await deps.previewCapture.capture({
    aeProjectItemIndex: request.aeProjectItemIndex,
    timestampSeconds: PREVIEW_TIMESTAMP_SECONDS
  });
  if (!previewResult.ok) {
    // All operations completed and saved, but a result with no verified
    // preview is still never acceptable (isSceneEditResultAcceptable) -
    // failureReason must say so explicitly, never leave it ambiguously
    // null next to a null previewFramePath.
    checkpoint = markFailed(checkpoint, `preview capture failed: ${previewResult.reason}`, deps.now());
    return finish({
      sourceProjectSha256: workingCopy.sourceProjectSha256,
      workingProjectPath: workingCopy.workingProjectPath,
      workingProjectSha256: savedHash.value.sha256,
      previewFramePath: null,
      previewTimestampSeconds: null
    });
  }

  // Section 3: "Worker preview PNG -> authenticated upload". A preview
  // that only ever exists on the worker's own local disk can never
  // actually be SEEN by the operator in the dashboard - the real bytes
  // must reach the API's durable storage before this job is ever reported
  // acceptable, mirroring RENDER's own "upload before SUCCEEDED" ordering.
  const uploaded = await deps.uploadPreview(previewResult.path);
  if (!uploaded.ok) {
    checkpoint = markFailed(checkpoint, `preview capture succeeded but upload failed: ${uploaded.reason}`, deps.now());
    return finish({
      sourceProjectSha256: workingCopy.sourceProjectSha256,
      workingProjectPath: workingCopy.workingProjectPath,
      workingProjectSha256: savedHash.value.sha256,
      previewFramePath: null,
      previewTimestampSeconds: null
    });
  }

  return finish({
    sourceProjectSha256: workingCopy.sourceProjectSha256,
    workingProjectPath: workingCopy.workingProjectPath,
    workingProjectSha256: savedHash.value.sha256,
    previewFramePath: previewResult.path,
    previewTimestampSeconds: previewResult.timestampSeconds
  });
}
