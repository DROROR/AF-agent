import { z } from "zod";
import type { ExecuteSceneEditRequest, SceneEditCheckpoint, SceneEditOperationIntent, SceneEditResult, WorkingCopyFailureCode } from "@dyo/schemas";
import { prepareSessionWorkingCopy, type WorkingCopyFailureReason } from "../workspace/working-copy.js";
import { hashSourceProject } from "../inspection/hash-source-project.js";
import { windowsPathsEqual } from "../inspection/canonical-windows-path.js";
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
 * The default frame this project's own "first-frame execution" workflow
 * (CLAUDE.md Required Workflow step 9) captures for EXECUTE_FRAME's
 * preview when the request doesn't specify one - t=0, exactly the prior
 * always-t=0 behavior for every normal (non-previewOnly) dispatch. A
 * `previewOnly` regeneration (live QA, 2026-09-08/09: t=0 landed on a
 * solid background color before any branding was visible) passes its own
 * chosen `request.previewTimestampSeconds` instead - see that field's own
 * doc comment (packages/schemas/execute-scene-edit.ts).
 */
const DEFAULT_PREVIEW_TIMESTAMP_SECONDS = 0;

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
  // Counts operations actually applied to the AE bridge DURING THIS
  // INVOCATION only - deliberately NOT checkpoint.completedOperationIndices
  // (which reflects the FULL cumulative history, including operations a
  // PRIOR attempt already completed and durably checkpointed before this
  // call even started). The WORKING_COPY_UNCHANGED_AFTER_MUTATION safety
  // check below must only fire when THIS run itself was expected to
  // change the working copy's bytes - a duplicate/already-fully-completed
  // job (pendingIndex is null immediately, the loop below never runs) is
  // a legitimate no-op resume, not a suspicious "nothing changed" outcome.
  let operationsAppliedThisRun = 0;

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

  // CRITICAL SAFETY FIX (live QA, 2026-09-08, real incident): the working
  // copy FILE existing on disk (just verified above) is not the same
  // thing as AE actually having it OPEN - a real EXECUTE_FRAME job proved
  // AE can still have a completely different project open (in that case,
  // the immutable SOURCE .aep itself, left open by an earlier, unrelated
  // read-only job) and every operation/save below would silently mutate
  // THAT instead (CLAUDE.md Safety Rule 1 violation). Defense in depth,
  // belt-and-suspenders with prepareSessionWorkingCopy's own SAME_PATH
  // check above (which already refuses when the two paths resolve
  // identically): explicitly re-assert here, via the SAME canonical
  // Windows path comparison openProject itself uses, that the working
  // copy is not somehow the source path before ever asking AE to open it.
  if (windowsPathsEqual(workingCopy.workingProjectPath, request.sourceProjectPath)) {
    checkpoint = markFailed(
      checkpoint,
      `internal error: the derived working-copy path resolves to the same file as the immutable source .aep (${workingCopy.workingProjectPath}) - refusing to proceed`,
      deps.now()
    );
    return finish({
      sourceProjectSha256: workingCopy.sourceProjectSha256,
      workingProjectPath: workingCopy.workingProjectPath,
      workingProjectSha256: workingCopy.workingProjectSha256,
      previewFramePath: null,
      previewTimestampSeconds: null,
      workingCopyFailureCode: "WORKING_COPY_NOT_OPENED"
    });
  }

  // Never trust "whatever project is currently open in AE" - explicitly
  // open the session's own real working copy and independently verify
  // AE's own self-reported path matches it exactly before ANY operation
  // or save is ever attempted (see AeEditBridge.openProject's own doc
  // comment for the full rationale - this is the actual fix for the real
  // incident).
  const opened = await deps.aeEditBridge.openProject(workingCopy.workingProjectPath);
  if (!opened.ok) {
    checkpoint = markFailed(checkpoint, `could not confirm the session working copy is open in After Effects: ${opened.failureReason}`, deps.now());
    return finish({
      sourceProjectSha256: workingCopy.sourceProjectSha256,
      workingProjectPath: workingCopy.workingProjectPath,
      workingProjectSha256: workingCopy.workingProjectSha256,
      previewFramePath: null,
      previewTimestampSeconds: null,
      workingCopyFailureCode: "WORKING_COPY_NOT_OPENED"
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
    operationsAppliedThisRun++;

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

  // CRITICAL SAFETY FIX (live QA, 2026-09-08, real incident) - HARD
  // SOURCE-IMMUTABILITY GUARD: independently re-hash the immutable
  // source .aep from disk RIGHT NOW, never trust the value this job was
  // dispatched with as still true. This is the exact, real check that
  // caught the actual incident (via a separate, manual INSPECT_SCENE_EVIDENCE
  // re-hash after the fact) - now built into every EXECUTE_FRAME job
  // itself, immediately after save, before any further AE operation
  // (preview capture) or any report of success is even considered. If
  // the source's own bytes changed at ANY point during this job's own
  // execution - regardless of why - this fails hard and permanently: the
  // resulting job failure carries workingCopyFailureCode
  // "SOURCE_PROJECT_MUTATED", which recordExecuteFrameResultIfApplicable
  // (apps/api) already marks the whole execution session FAILED for
  // (the exact same wiring WORKING_COPY_MISSING/SHA_MISMATCH already use)
  // - never silently retryable, section 11's "start a new execution
  // session" is the only way forward.
  const sourceHashAfter = await hashSourceProject(request.sourceProjectPath);
  if (!sourceHashAfter.ok || sourceHashAfter.value.sha256 !== request.sourceProjectSha256) {
    checkpoint = markFailed(
      checkpoint,
      "CRITICAL SAFETY VIOLATION (SOURCE_PROJECT_MUTATED): the immutable source .aep no longer matches its expected sha256 " +
        `after this job's own operations/save${sourceHashAfter.ok ? ` (now ${sourceHashAfter.value.sha256}, expected ${request.sourceProjectSha256})` : ` (could not be re-verified: ${sourceHashAfter.reason})`} - ` +
        "the source project may have been overwritten. Refusing to report success, refusing to capture or upload any preview. " +
        "Stop immediately - do not render or export from this session.",
      deps.now()
    );
    return finish({
      sourceProjectSha256: request.sourceProjectSha256,
      workingProjectPath: workingCopy.workingProjectPath,
      workingProjectSha256: savedHash.value.sha256,
      previewFramePath: null,
      previewTimestampSeconds: null,
      workingCopyFailureCode: "SOURCE_PROJECT_MUTATED"
    });
  }

  // WORKING COPY VERIFICATION: prove real edits actually landed on disk -
  // a mutation job that applied one or more operations DURING THIS RUN
  // (operationsAppliedThisRun, never the full cumulative checkpoint
  // history - see that variable's own doc comment) but whose saved
  // working copy is byte-identical to what it was BEFORE those operations
  // ran is suspicious by construction (a genuine content change to a real
  // binary .aep should always alter some bytes) and must never be
  // reported as a success.
  if (operationsAppliedThisRun > 0 && savedHash.value.sha256 === workingCopy.workingProjectSha256) {
    checkpoint = markFailed(
      checkpoint,
      `SAFETY CHECK FAILED (WORKING_COPY_UNCHANGED_AFTER_MUTATION): ${operationsAppliedThisRun} operation(s) reported successful ` +
        "completion in this run, but the saved working copy's own sha256 is unchanged from before those operations ran " +
        `(${savedHash.value.sha256}) - the mutation may not have actually been persisted. Refusing to report success.`,
      deps.now()
    );
    return finish({
      sourceProjectSha256: workingCopy.sourceProjectSha256,
      workingProjectPath: workingCopy.workingProjectPath,
      workingProjectSha256: savedHash.value.sha256,
      previewFramePath: null,
      previewTimestampSeconds: null,
      workingCopyFailureCode: "WORKING_COPY_UNCHANGED_AFTER_MUTATION"
    });
  }

  // Mirror image of the check above, for `previewOnly` specifically
  // (First Preview regeneration, live QA 2026-09-08/09): zero operations
  // were ever requested, so the saved working copy must stay byte-
  // identical to what it was before this run. Any change means something
  // mutated it outside this job's own knowledge - never treated as a safe
  // recapture.
  if (request.previewOnly === true && savedHash.value.sha256 !== workingCopy.workingProjectSha256) {
    checkpoint = markFailed(
      checkpoint,
      "SAFETY CHECK FAILED (WORKING_COPY_UNEXPECTEDLY_MUTATED): this was a previewOnly run (zero operations requested), but the " +
        `saved working copy's sha256 (${savedHash.value.sha256}) differs from what it was before this run ` +
        `(${workingCopy.workingProjectSha256}) - refusing to report success.`,
      deps.now()
    );
    return finish({
      sourceProjectSha256: workingCopy.sourceProjectSha256,
      workingProjectPath: workingCopy.workingProjectPath,
      workingProjectSha256: savedHash.value.sha256,
      previewFramePath: null,
      previewTimestampSeconds: null,
      workingCopyFailureCode: "WORKING_COPY_UNEXPECTEDLY_MUTATED"
    });
  }

  const previewResult = await deps.previewCapture.capture({
    aeProjectItemIndex: request.aeProjectItemIndex,
    timestampSeconds: request.previewTimestampSeconds ?? DEFAULT_PREVIEW_TIMESTAMP_SECONDS
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
