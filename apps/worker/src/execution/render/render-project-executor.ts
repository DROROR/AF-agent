import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { RenderArtifact, RenderCheckpoint, RenderProjectRequest, RenderProjectResult } from "@dyo/schemas";
import { hashSourceProject } from "../../inspection/hash-source-project.js";
import { ensureWorkRoot } from "../../workspace/work-root.js";
import { sessionWorkingCopyPath } from "../../workspace/working-copy.js";
import { EMPTY_SCENE_EDIT_CHECKPOINT, markFailed, markOperationCompleted, nextPendingOperationIndex } from "../scene-edit-checkpoint.js";
import { renderOutputFilename, renderOutputPath } from "./render-output-path.js";
import { validateRenderArtifact } from "./validate-render-artifact.js";
import type { CompositionVerifier } from "./verify-render-composition.js";
import type { AerenderRunner } from "./aerender-runner.js";
import type { RenderArtifactUploader } from "./upload-render-artifact.js";
import type { PersistCheckpoint } from "../execute-scene-edit-executor.js";

const RENDER_STAGE_COUNT = 4; // VERIFY_WORKING_COPY, VERIFY_COMPOSITION, RUN_AERENDER, VALIDATE_ARTIFACT - see render-project.ts's RENDER_STAGES.
const MIME_TYPE_MP4 = "video/mp4";

export interface RenderProjectExecutorDeps {
  workRoot: string;
  aerenderPath: string | undefined;
  aerenderRunner: AerenderRunner;
  compositionVerifier: CompositionVerifier;
  artifactUploader: RenderArtifactUploader;
  persistCheckpoint: PersistCheckpoint;
  now: () => Date;
}

/**
 * The full RENDER pipeline: verify the already-edited working copy is
 * genuinely present and unchanged, independently prove the intended
 * composition is unambiguous (verify-render-composition.ts), invoke the
 * one real `aerender` process (never a shell string), then verify the
 * resulting output file on disk before ever calling this a success.
 *
 * Mirrors execute-scene-edit-executor.ts's exact shape: a while loop over
 * still-pending fixed stages, a checkpoint persisted durably after EACH
 * stage completes (never mid-stage), and a pause-rather-than-continue
 * response if that durable persistence itself ever fails - see
 * PersistCheckpoint's own doc comment (execute-scene-edit-executor.ts).
 *
 * Never renders the ORIGINAL source .aep (CLAUDE.md Safety Rule 1): this
 * only ever opens/renders the working copy it derives itself from
 * `request.executionSessionId` (sessionWorkingCopyPath - the same
 * cumulative file EXECUTE_FRAME edited), and independently re-verifies
 * `request.sourceProjectPath` is unchanged both before AND after
 * rendering.
 */
export async function executeRenderProject(
  deps: RenderProjectExecutorDeps,
  jobId: string,
  request: RenderProjectRequest
): Promise<RenderProjectResult> {
  const startedAt = deps.now().toISOString();
  let checkpoint: RenderCheckpoint = request.checkpoint ?? EMPTY_SCENE_EDIT_CHECKPOINT;
  let artifact: RenderArtifact | null = null;

  // Derived from this worker's own configured workRoot + the session id -
  // never taken from the request (multi-scene-accumulation phase, section
  // 12: "Worker derives same execution-session AEP path"). Safe by
  // construction (sessionWorkingCopyPath/safeJoin block traversal), so no
  // separate assertPathWithinRoot check is needed the way the OLD
  // request-supplied workingProjectPath required.
  const workingProjectPath = sessionWorkingCopyPath(deps.workRoot, request.executionSessionId);

  function finish(): RenderProjectResult {
    return {
      executionSessionId: request.executionSessionId,
      variant: request.variant,
      workingProjectSha256: request.expectedWorkingProjectSha256,
      artifact,
      checkpoint,
      failureReason: checkpoint.failureReason,
      startedAt,
      completedAt: deps.now().toISOString()
    };
  }

  async function persistOrPause(stageLabel: string): Promise<RenderProjectResult | null> {
    const persisted = await deps.persistCheckpoint(checkpoint);
    if (!persisted.ok) {
      checkpoint = markFailed(
        checkpoint,
        `checkpoint persistence failed after stage ${stageLabel} completed: ${persisted.reason} - pausing rather than continuing with unknown durable checkpoint state`,
        deps.now()
      );
      return finish();
    }
    return null;
  }

  if (!deps.aerenderPath) {
    checkpoint = markFailed(checkpoint, "AERENDER_PATH is not configured on this worker - cannot render", deps.now());
    return finish();
  }

  let pending = nextPendingOperationIndex(checkpoint, RENDER_STAGE_COUNT);
  while (pending !== null) {
    checkpoint = { ...checkpoint, checkpointBeforeAt: deps.now().toISOString() };

    if (pending === 0) {
      // VERIFY_WORKING_COPY - never trusts a caller-supplied path; the
      // session-derived workingProjectPath above is safe by construction,
      // so this only needs to re-verify the file's real CONTENT (existence
      // + sha256) against what the session's own durable record expects,
      // and that it is genuinely distinct from the original source
      // (CLAUDE.md Safety Rule 1 - the same defense-in-depth check
      // EXECUTE_FRAME's own prepareWorkingCopy applies).
      if (path.resolve(workingProjectPath) === path.resolve(request.sourceProjectPath)) {
        checkpoint = markFailed(checkpoint, "the derived working copy path resolves to the same file as sourceProjectPath - refusing to render the original .aep", deps.now());
        return finish();
      }

      if (!existsSync(workingProjectPath)) {
        checkpoint = markFailed(
          checkpoint,
          `no working copy found for this execution session at the expected local path - dispatch EXECUTE_FRAME for at least one approved scene before rendering`,
          deps.now()
        );
        return finish();
      }

      const workingHash = await hashSourceProject(workingProjectPath);
      if (!workingHash.ok) {
        checkpoint = markFailed(checkpoint, `working copy could not be verified (${workingHash.reason})`, deps.now());
        return finish();
      }
      if (workingHash.value.sha256 !== request.expectedWorkingProjectSha256) {
        checkpoint = markFailed(
          checkpoint,
          `working copy sha256 (${workingHash.value.sha256}) does not match the expected sha256 (${request.expectedWorkingProjectSha256}) - refusing to render a project that has changed`,
          deps.now()
        );
        return finish();
      }

      const sourceHash = await hashSourceProject(request.sourceProjectPath);
      if (!sourceHash.ok || sourceHash.value.sha256 !== request.sourceProjectSha256) {
        checkpoint = markFailed(
          checkpoint,
          `original source .aep could not be verified as unchanged before rendering (${sourceHash.ok ? "sha256 mismatch" : sourceHash.reason})`,
          deps.now()
        );
        return finish();
      }

      checkpoint = markOperationCompleted(checkpoint, 0, deps.now());
    } else if (pending === 1) {
      // VERIFY_COMPOSITION - see verify-render-composition.ts.
      const verified = await deps.compositionVerifier.verify({
        workingProjectPath,
        aeProjectItemIndex: request.aeProjectItemIndex,
        compositionName: request.compositionName
      });
      if (!verified.ok) {
        checkpoint = markFailed(checkpoint, `composition verification failed: ${verified.reason}`, deps.now());
        return finish();
      }
      checkpoint = markOperationCompleted(checkpoint, 1, deps.now());
    } else if (pending === 2) {
      // RUN_AERENDER - delete any pre-existing file at this attempt's output
      // path FIRST (section 10: "remove ... the intended output so stale
      // artifacts cannot pass validation") so a resumed/retried attempt can
      // never have a stale/partial file from an earlier attempt silently
      // satisfy VALIDATE_ARTIFACT below.
      const outputPath = renderOutputPath(deps.workRoot, jobId, request.variant);
      ensureWorkRoot(path.dirname(outputPath));
      if (existsSync(outputPath)) {
        try {
          unlinkSync(outputPath);
        } catch (error) {
          checkpoint = markFailed(
            checkpoint,
            `could not remove a pre-existing/stale output file before rendering: ${error instanceof Error ? error.message : String(error)}`,
            deps.now()
          );
          return finish();
        }
      }

      const runResult = await deps.aerenderRunner.run({
        executablePath: deps.aerenderPath,
        projectPath: workingProjectPath,
        compName: request.compositionName,
        renderSettingsTemplateName: request.renderSettingsTemplateName,
        outputModuleTemplateName: request.outputModuleTemplateName,
        outputPath
      });

      if (!runResult.ok) {
        checkpoint = markFailed(checkpoint, `aerender could not be started: ${runResult.spawnError ?? "unknown spawn failure"}`, deps.now());
        return finish();
      }
      if (runResult.timedOut) {
        checkpoint = markFailed(checkpoint, "aerender timed out and was terminated", deps.now());
        return finish();
      }
      if (runResult.exitCode !== 0) {
        const stderrExcerpt = runResult.stderr.slice(-2000);
        checkpoint = markFailed(
          checkpoint,
          `aerender exited with code ${String(runResult.exitCode)}${runResult.signal ? ` (signal ${runResult.signal})` : ""}: ${stderrExcerpt}`,
          deps.now()
        );
        return finish();
      }

      // Build the artifact record now (before VALIDATE_ARTIFACT even runs) so
      // its own render-timing/log fields are always populated from THIS
      // run's real result, never re-derived later from nothing - VALIDATE_ARTIFACT
      // only ever fills in/overrides byteSize + validationStatus.
      const logExcerpt = (runResult.stdout + (runResult.stderr ? `\n--- stderr ---\n${runResult.stderr}` : "")).slice(-4000) || null;
      artifact = {
        variant: request.variant,
        workingProjectSha256: request.expectedWorkingProjectSha256,
        compositionName: request.compositionName,
        filename: renderOutputFilename(),
        mimeType: MIME_TYPE_MP4,
        byteSize: 0,
        renderStartedAt: runResult.startedAt,
        renderCompletedAt: runResult.completedAt,
        aerenderExitCode: runResult.exitCode,
        logExcerpt,
        validationStatus: "INVALID",
        validationFailureReason: "not yet validated"
      };

      checkpoint = markOperationCompleted(checkpoint, 2, deps.now());
    } else if (pending === 3) {
      // VALIDATE_ARTIFACT - a render is SUCCESS only if the expected file
      // genuinely exists, is a regular file, and is non-zero size (section
      // 10). If this is reached on a RESUMED attempt (stage 2 was already
      // marked complete in a PRIOR process run), this independently
      // re-verifies the file rather than trusting the earlier stage's own
      // completion flag - see validate-render-artifact.ts's own doc comment.
      const outputPath = renderOutputPath(deps.workRoot, jobId, request.variant);
      const validation = validateRenderArtifact(outputPath);

      const artifactSoFar: RenderArtifact | null = artifact;
      if (!artifactSoFar) {
        // Resuming in a fresh process after stage 2 already completed in an
        // earlier run - this run never itself invoked aerender, so there is
        // no fresh runResult to build an artifact from. Reconstructing full
        // render-timing/exit-code facts across a process restart without a
        // durable record of them is not honestly possible - report exactly
        // that as a typed failure rather than fabricating placeholder values.
        checkpoint = markFailed(
          checkpoint,
          "cannot validate: this process run never itself ran aerender for this job (stage RUN_AERENDER was already marked complete by an earlier process attempt, whose render-timing/exit-code facts were not durably preserved) - dispatch a fresh RENDER job attempt",
          deps.now()
        );
        return finish();
      }

      if (!validation.ok) {
        artifact = { ...(artifactSoFar as RenderArtifact), validationStatus: "INVALID", validationFailureReason: validation.reason };
        checkpoint = markFailed(checkpoint, `artifact validation failed: ${validation.reason}`, deps.now());
        return finish();
      }

      artifact = { ...(artifactSoFar as RenderArtifact), byteSize: validation.byteSize, validationStatus: "VALID", validationFailureReason: null };
      checkpoint = markOperationCompleted(checkpoint, 3, deps.now());
    }

    const paused = await persistOrPause(String(pending));
    if (paused) {
      return paused;
    }
    pending = nextPendingOperationIndex(checkpoint, RENDER_STAGE_COUNT);
  }

  // Final honesty check: the original source .aep must remain byte-for-byte
  // unchanged throughout the ENTIRE render, not just at stage 0.
  const finalSourceHash = await hashSourceProject(request.sourceProjectPath);
  if (!finalSourceHash.ok || finalSourceHash.value.sha256 !== request.sourceProjectSha256) {
    checkpoint = markFailed(checkpoint, "original source .aep changed during rendering - safety violation, never trusted as a valid render", deps.now());
    artifact = null;
    return finish();
  }

  // UPLOAD - the real rendered bytes must reach the API's durable storage
  // BEFORE this job is ever reported SUCCEEDED (see
  // record-render-artifact.ts's own doc comment: a SUCCEEDED report with no
  // matching upload on record is silently never persisted - this is what
  // guarantees that ordering). Not one of the 4 fixed checkpoint stages
  // (RENDER_STAGE_COUNT is unchanged) - a resumed job that reaches here
  // again simply re-uploads, which the API's own upload endpoint accepts
  // idempotently by content hash (see upload-render-artifact.ts, API side).
  if (artifact && artifact.validationStatus === "VALID") {
    const outputPath = renderOutputPath(deps.workRoot, jobId, request.variant);
    const uploaded = await deps.artifactUploader.upload({
      jobId,
      variant: request.variant,
      filePath: outputPath,
      mimeType: artifact.mimeType
    });
    if (!uploaded.ok) {
      checkpoint = markFailed(checkpoint, `artifact upload failed: ${uploaded.reason}`, deps.now());
      artifact = { ...artifact, validationStatus: "INVALID", validationFailureReason: `upload failed: ${uploaded.reason}` };
    }
  }

  return finish();
}
