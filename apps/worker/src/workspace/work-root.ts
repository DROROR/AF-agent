import { mkdirSync } from "node:fs";
import path from "node:path";
import { UnsafePathError } from "../errors/worker-error.js";

const JOB_ID_PATTERN = /^[a-zA-Z0-9-]{1,100}$/;
const EXECUTION_SESSION_ID_PATTERN = /^[a-zA-Z0-9-]{1,100}$/;

/** Normalizes a configured work root to an absolute path. */
export function resolveWorkRoot(rawRoot: string): string {
  return path.resolve(rawRoot);
}

/** Creates the work root if it does not already exist. */
export function ensureWorkRoot(root: string): void {
  mkdirSync(root, { recursive: true });
}

function assertSafeSegment(segment: string): void {
  if (segment.includes("\0")) {
    throw new UnsafePathError(`Path segment contains a null byte: ${segment}`, "invalid-segment");
  }
  if (path.isAbsolute(segment)) {
    throw new UnsafePathError(`Path segment must be relative, got: ${segment}`, "absolute");
  }
}

/**
 * Joins path segments onto `root` and guarantees the result stays inside
 * `root` - see docs/engineering/SECURITY.md ("restrict job files to a
 * configured work root ... normalize/validate paths and reject traversal").
 * Throws UnsafePathError rather than silently clamping, so a caller can never
 * mistake a rejected path for a valid one.
 */
export function safeJoin(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  for (const segment of segments) {
    assertSafeSegment(segment);
  }
  const candidate = path.resolve(resolvedRoot, ...segments);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (candidate !== resolvedRoot && !candidate.startsWith(rootWithSep)) {
    throw new UnsafePathError(
      `Resolved path escapes the work root: ${candidate} is not inside ${resolvedRoot}`,
      "traversal"
    );
  }
  return candidate;
}

/**
 * Every job gets its own isolated subdirectory under the work root, keyed by
 * a validated job ID - never by a caller-supplied path.
 */
export function jobWorkspacePath(root: string, jobId: string): string {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new UnsafePathError(`Job ID is not a safe path segment: ${jobId}`, "invalid-segment");
  }
  return safeJoin(root, "jobs", jobId);
}

/**
 * Every PROJECT EXECUTION SESSION gets its own isolated subdirectory under
 * the work root, keyed by a validated executionSessionId - never by a
 * caller-supplied path (multi-scene-accumulation phase, section 3). This
 * is the workspace the session's CUMULATIVE working copy lives in across
 * every scene's own EXECUTE_FRAME job and both output renders - distinct
 * from jobWorkspacePath above, which is scoped to ONE job only.
 */
export function sessionWorkspacePath(root: string, executionSessionId: string): string {
  if (!EXECUTION_SESSION_ID_PATTERN.test(executionSessionId)) {
    throw new UnsafePathError(`Execution session ID is not a safe path segment: ${executionSessionId}`, "invalid-segment");
  }
  return safeJoin(root, "execution-sessions", executionSessionId);
}

/**
 * Verifies an ALREADY-ABSOLUTE path still resolves strictly inside the
 * configured work root - the same traversal-safety guarantee `safeJoin`
 * gives paths it builds itself, applied instead to a path this worker did
 * not construct. Throws UnsafePathError rather than silently clamping,
 * matching safeJoin's own contract. (As of the multi-scene-accumulation
 * phase, every path this worker touches - including RENDER's
 * workingProjectPath - is derived internally via sessionWorkingCopyPath/
 * safeJoin rather than accepted as an already-absolute value, so this is
 * currently unused in production; kept as a general-purpose safety
 * primitive for any future caller that does need to verify a path it did
 * not itself construct.)
 */
export function assertPathWithinRoot(root: string, candidatePath: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidatePath);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(rootWithSep)) {
    throw new UnsafePathError(
      `Path escapes the work root: ${resolvedCandidate} is not inside ${resolvedRoot}`,
      "traversal"
    );
  }
}
