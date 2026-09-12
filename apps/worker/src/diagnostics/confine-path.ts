import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

/**
 * Every filesystem read a diagnostic performs is confined to the worker's own
 * configured work root (C:\DYO-Agent in production).
 *
 * The strong form of this guarantee is structural, not defensive: no
 * diagnostic operation accepts a path from a caller AT ALL (see
 * diagnostics.ts - the request schema has no path field). This module exists
 * so that the paths the worker builds for ITSELF are still checked, and so
 * that a future operation cannot quietly introduce a traversal by
 * concatenating a caller-influenced segment.
 */
export class PathOutsideWorkRootError extends Error {
  constructor(
    readonly requestedPath: string,
    readonly workRoot: string
  ) {
    // The rejected path is echoed because it is worker-built, never
    // caller-supplied, and an operator debugging a refusal needs to see it.
    super(`Refusing to read "${requestedPath}": outside the worker work root "${workRoot}"`);
    this.name = "PathOutsideWorkRootError";
  }
}

/**
 * Resolves `candidate` (absolute, or relative to the work root) and throws
 * unless the result is the work root itself or genuinely inside it.
 *
 * Uses path.relative rather than a string prefix test: a prefix test accepts
 * "C:\DYO-Agent-secrets" for the root "C:\DYO-Agent", which is a different
 * directory entirely.
 */
export function confineToWorkRoot(workRoot: string, candidate: string): string {
  if (!workRoot || !isAbsolute(workRoot)) {
    throw new Error(`A work root must be an absolute path, received "${workRoot}"`);
  }
  const root = resolve(normalize(workRoot));
  const target = resolve(root, normalize(candidate));
  const rel = relative(root, target);

  const escapes = rel.startsWith("..") || (rel !== "" && isAbsolute(rel)) || rel.split(sep).includes("..");
  if (escapes) {
    throw new PathOutsideWorkRootError(candidate, workRoot);
  }
  return target;
}

export function isInsideWorkRoot(workRoot: string, candidate: string): boolean {
  try {
    confineToWorkRoot(workRoot, candidate);
    return true;
  } catch {
    return false;
  }
}
