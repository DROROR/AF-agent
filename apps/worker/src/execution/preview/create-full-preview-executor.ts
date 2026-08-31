import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { CreateFullPreviewRequest, CreateFullPreviewResult, FullPreviewArtifact } from "@dyo/schemas";
import { hashSourceProject } from "../../inspection/hash-source-project.js";
import { ensureWorkRoot } from "../../workspace/work-root.js";
import { sessionWorkingCopyPath } from "../../workspace/working-copy.js";
import { fullPreviewOutputFilename, fullPreviewOutputPath } from "./full-preview-output-path.js";
import { validateRenderArtifact } from "../render/validate-render-artifact.js";
import type { CompositionVerifier } from "../render/verify-render-composition.js";
import type { AerenderRunner } from "../render/aerender-runner.js";
import type { FullPreviewUploader } from "./upload-full-preview.js";

const MIME_TYPE_MP4 = "video/mp4";

export interface CreateFullPreviewExecutorDeps {
  workRoot: string;
  aerenderPath: string | undefined;
  aerenderRunner: AerenderRunner;
  compositionVerifier: CompositionVerifier;
  fullPreviewUploader: FullPreviewUploader;
  now: () => Date;
}

/**
 * The full CREATE_PREVIEW pipeline (client-handoff completion phase,
 * section R/S) - a real, full-duration video of the session's CURRENT
 * cumulative working copy, produced through the exact same real
 * `aerender` process RENDER already uses (never a shell string, never a
 * metadata-only fabrication), against the project's own already-approved
 * LANDSCAPE render output identity. Never renders the ORIGINAL source
 * .aep (CLAUDE.md Safety Rule 1) - only ever the working copy this
 * session's own EXECUTE_FRAME jobs already produced, re-verified by
 * sha256 both before and after this runs, exactly like RENDER.
 *
 * Deliberately single-shot, linear, and NOT checkpoint-resumable (unlike
 * EXECUTE_FRAME/RENDER's fixed-stage checkpoint loop) - see
 * create-full-preview.ts's own doc comment in @dyo/schemas: a complete
 * preview is a quick, low-stakes review artifact, not a mission-critical
 * final deliverable, so a failed/interrupted attempt is simply
 * re-dispatched from scratch (a fresh CREATE_PREVIEW job) rather than
 * needing true partial-progress resume. Every stage is still safely
 * retryable on its own: RUN_AERENDER deletes any stale prior output
 * before writing a new one (the same idempotent-retry pattern RENDER's
 * own RUN_AERENDER stage uses), so re-dispatching after any failure can
 * never let a stale/partial file from an earlier attempt pass validation.
 */
export async function executeCreateFullPreview(deps: CreateFullPreviewExecutorDeps, jobId: string, request: CreateFullPreviewRequest): Promise<CreateFullPreviewResult> {
  const startedAt = deps.now().toISOString();

  function finish(failureReason: string | null, artifact: FullPreviewArtifact | null): CreateFullPreviewResult {
    return {
      executionSessionId: request.executionSessionId,
      workingProjectSha256: request.expectedWorkingProjectSha256,
      artifact,
      failureReason,
      startedAt,
      completedAt: deps.now().toISOString()
    };
  }

  if (!deps.aerenderPath) {
    return finish("AERENDER_PATH is not configured on this worker - cannot create a complete preview", null);
  }

  // VERIFY_WORKING_COPY - derived from this worker's own configured
  // workRoot + the session id, never taken from the request (same rule as
  // RENDER's own VERIFY_WORKING_COPY stage).
  const workingProjectPath = sessionWorkingCopyPath(deps.workRoot, request.executionSessionId);
  if (path.resolve(workingProjectPath) === path.resolve(request.sourceProjectPath)) {
    return finish("the derived working copy path resolves to the same file as sourceProjectPath - refusing to preview the original .aep", null);
  }
  if (!existsSync(workingProjectPath)) {
    return finish("no working copy found for this execution session at the expected local path - dispatch EXECUTE_FRAME for at least one approved scene before creating a complete preview", null);
  }

  const workingHash = await hashSourceProject(workingProjectPath);
  if (!workingHash.ok) {
    return finish(`working copy could not be verified (${workingHash.reason})`, null);
  }
  if (workingHash.value.sha256 !== request.expectedWorkingProjectSha256) {
    return finish(`working copy sha256 (${workingHash.value.sha256}) does not match the expected sha256 (${request.expectedWorkingProjectSha256}) - refusing to preview a project that has changed`, null);
  }

  const sourceHashBefore = await hashSourceProject(request.sourceProjectPath);
  if (!sourceHashBefore.ok || sourceHashBefore.value.sha256 !== request.sourceProjectSha256) {
    return finish(
      `original source .aep could not be verified as unchanged before creating a complete preview (${sourceHashBefore.ok ? "sha256 mismatch" : sourceHashBefore.reason})`,
      null
    );
  }

  // VERIFY_COMPOSITION - see verify-render-composition.ts.
  const verified = await deps.compositionVerifier.verify({
    workingProjectPath,
    aeProjectItemIndex: request.aeProjectItemIndex,
    compositionName: request.compositionName
  });
  if (!verified.ok) {
    return finish(`composition verification failed: ${verified.reason}`, null);
  }

  // RUN_AERENDER - delete any pre-existing file at this attempt's output
  // path FIRST (same "stale artifacts can never pass validation" rule as
  // RENDER's own RUN_AERENDER stage).
  const outputPath = fullPreviewOutputPath(deps.workRoot, jobId);
  ensureWorkRoot(path.dirname(outputPath));
  if (existsSync(outputPath)) {
    try {
      unlinkSync(outputPath);
    } catch (error) {
      return finish(`could not remove a pre-existing/stale complete-preview output file before rendering: ${error instanceof Error ? error.message : String(error)}`, null);
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
    return finish(`aerender could not be started: ${runResult.spawnError ?? "unknown spawn failure"}`, null);
  }
  if (runResult.timedOut) {
    return finish("aerender timed out and was terminated", null);
  }
  if (runResult.exitCode !== 0) {
    const stderrExcerpt = runResult.stderr.slice(-2000);
    return finish(`aerender exited with code ${String(runResult.exitCode)}${runResult.signal ? ` (signal ${runResult.signal})` : ""}: ${stderrExcerpt}`, null);
  }

  // VALIDATE_ARTIFACT - a complete preview is only ever SUCCESS if the
  // expected output file genuinely exists, is a regular file, and is
  // non-zero size (same rule as RENDER's own VALIDATE_ARTIFACT stage -
  // reused directly, never a metadata-only fabrication of readiness).
  const validation = validateRenderArtifact(outputPath);
  if (!validation.ok) {
    return finish(`complete-preview artifact validation failed: ${validation.reason}`, null);
  }

  // Final honesty check: the original source .aep must remain
  // byte-for-byte unchanged throughout the ENTIRE preview creation, not
  // just before it started.
  const sourceHashAfter = await hashSourceProject(request.sourceProjectPath);
  if (!sourceHashAfter.ok || sourceHashAfter.value.sha256 !== request.sourceProjectSha256) {
    return finish("original source .aep changed while creating the complete preview - safety violation, never trusted as a valid preview", null);
  }

  const capturedAt = deps.now().toISOString();
  const artifact: FullPreviewArtifact = {
    workingProjectSha256: request.expectedWorkingProjectSha256,
    compositionName: request.compositionName,
    filename: fullPreviewOutputFilename(),
    mimeType: MIME_TYPE_MP4,
    byteSize: validation.byteSize,
    capturedAt
  };

  // UPLOAD - the real preview bytes must reach the API's durable storage
  // BEFORE this job is ever reported SUCCEEDED (same ordering RENDER's
  // own upload step guarantees).
  const uploaded = await deps.fullPreviewUploader.upload({ jobId, filePath: outputPath, mimeType: artifact.mimeType });
  if (!uploaded.ok) {
    return finish(`complete-preview upload failed: ${uploaded.reason}`, null);
  }

  return finish(null, artifact);
}
