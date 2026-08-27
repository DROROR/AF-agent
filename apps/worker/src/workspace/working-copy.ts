import { copyFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { hashSourceProject } from "../inspection/hash-source-project.js";
import { ensureWorkRoot, jobWorkspacePath, safeJoin } from "./work-root.js";

/**
 * Deterministic working-copy lifecycle for EXECUTE_FRAME (CLAUDE.md Safety
 * Rule 1: "never overwrite the original .aep"). The destination path is
 * NEVER taken from caller/network input - it is always re-derived here
 * from (workRoot, jobId), the same job-scoped-workspace primitive
 * INSPECT_TEMPLATE/INSPECT_SCENE_EVIDENCE already trust for path safety
 * (see workspace/work-root.ts: safeJoin blocks traversal, jobWorkspacePath
 * validates the jobId itself). A request's own `workingProjectPath` field
 * is only ever an ASSERTION to be verified against this locally-derived
 * path, never a value used directly in an `fs` call.
 */
const WORKING_COPY_FILENAME = "working-copy.aep";

export function workingCopyPath(workRoot: string, jobId: string): string {
  return safeJoin(jobWorkspacePath(workRoot, jobId), WORKING_COPY_FILENAME);
}

export interface PrepareWorkingCopyParams {
  workRoot: string;
  jobId: string;
  sourceProjectPath: string;
  expectedSourceSha256: string;
}

export interface WorkingCopyReady {
  ok: true;
  workingProjectPath: string;
  /** Re-verified now, from the real file on disk - never merely echoed back from the request. */
  sourceProjectSha256: string;
  workingProjectSha256: string;
  /** True when an existing, valid working copy was reused rather than freshly copied - the resume path (section 2: "resume reuses existing valid working copy"). */
  resumed: boolean;
}

export type WorkingCopyFailureReason =
  | "SAME_PATH"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_SHA_MISMATCH"
  | "COPY_FAILED"
  | "WORKING_COPY_INVALID";

export interface WorkingCopyFailure {
  ok: false;
  reason: WorkingCopyFailureReason;
  message: string;
}

export type WorkingCopyResult = WorkingCopyReady | WorkingCopyFailure;

function hashOrFail(filePath: string, failReason: WorkingCopyFailureReason) {
  return hashSourceProject(filePath).then((result) =>
    result.ok
      ? { ok: true as const, sha256: result.value.sha256 }
      : { ok: false as const, reason: failReason, message: result.reason }
  );
}

/**
 * Verifies the source .aep still matches `expectedSourceSha256`, then
 * either reuses an existing valid working copy (resume) or creates a new
 * one by copying the source into the job's own workspace directory -
 * never the reverse, never in place. The source is re-hashed a SECOND
 * time immediately after a fresh copy completes, to catch a source file
 * that changed mid-copy (a race the single before-copy check alone cannot
 * detect) - if that happens, the just-created working copy is left on
 * disk (kept for forensic value, matching this project's "never silently
 * discard" convention elsewhere) but the result is still reported as a
 * failure, never a false success.
 */
export async function prepareWorkingCopy(params: PrepareWorkingCopyParams): Promise<WorkingCopyResult> {
  const destPath = workingCopyPath(params.workRoot, params.jobId);

  if (path.resolve(params.sourceProjectPath) === path.resolve(destPath)) {
    return {
      ok: false,
      reason: "SAME_PATH",
      message: `sourceProjectPath and the derived working copy path resolve to the same file (${destPath}) - refusing to treat the source as its own working copy`
    };
  }

  const sourceHashBefore = await hashOrFail(params.sourceProjectPath, "SOURCE_NOT_FOUND");
  if (!sourceHashBefore.ok) {
    return sourceHashBefore;
  }
  if (sourceHashBefore.sha256 !== params.expectedSourceSha256) {
    return {
      ok: false,
      reason: "SOURCE_SHA_MISMATCH",
      message: `source .aep sha256 (${sourceHashBefore.sha256}) does not match the expected sha256 (${params.expectedSourceSha256}) - the source project has changed since this job was created; refusing to proceed`
    };
  }

  if (existsSync(destPath)) {
    // Resume path: an existing working copy is reused as-is, never
    // re-copied over - a re-copy here could silently discard in-progress
    // edits a prior job attempt already made to it.
    let stat;
    try {
      stat = statSync(destPath);
    } catch (error) {
      return {
        ok: false,
        reason: "WORKING_COPY_INVALID",
        message: `existing working copy at ${destPath} could not be read: ${error instanceof Error ? error.message : String(error)}`
      };
    }
    if (!stat.isFile() || stat.size === 0) {
      return {
        ok: false,
        reason: "WORKING_COPY_INVALID",
        message: `existing working copy at ${destPath} is not a valid non-empty file`
      };
    }
    const workingHash = await hashOrFail(destPath, "WORKING_COPY_INVALID");
    if (!workingHash.ok) {
      return workingHash;
    }
    return {
      ok: true,
      workingProjectPath: destPath,
      sourceProjectSha256: sourceHashBefore.sha256,
      workingProjectSha256: workingHash.sha256,
      resumed: true
    };
  }

  ensureWorkRoot(path.dirname(destPath));

  try {
    copyFileSync(params.sourceProjectPath, destPath);
  } catch (error) {
    return {
      ok: false,
      reason: "COPY_FAILED",
      message: `could not copy ${params.sourceProjectPath} to ${destPath}: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  // Race detection: re-verify the SOURCE (not the copy) is still exactly
  // what it was before the copy started.
  const sourceHashAfter = await hashOrFail(params.sourceProjectPath, "SOURCE_NOT_FOUND");
  if (!sourceHashAfter.ok || sourceHashAfter.sha256 !== params.expectedSourceSha256) {
    return {
      ok: false,
      reason: "SOURCE_SHA_MISMATCH",
      message: "source .aep changed while it was being copied - refusing to treat the resulting working copy as trustworthy"
    };
  }

  const workingHash = await hashOrFail(destPath, "WORKING_COPY_INVALID");
  if (!workingHash.ok) {
    return workingHash;
  }

  return {
    ok: true,
    workingProjectPath: destPath,
    sourceProjectSha256: sourceHashBefore.sha256,
    workingProjectSha256: workingHash.sha256,
    resumed: false
  };
}
