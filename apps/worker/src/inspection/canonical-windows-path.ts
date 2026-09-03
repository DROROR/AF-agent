import path from "node:path";

/**
 * P0 fix (2026-09-03): case-insensitive, separator-normalized comparison
 * for Windows file paths - the worker/AE machine is always Windows
 * (CLAUDE.md's locked architecture), and both AE's own `File.fsName` and
 * this worker's own `sourceProjectPath` request field use native Windows
 * path conventions (backslash-separated, case-insensitive filesystem).
 * Uses `node:path`'s `win32` variant explicitly so this stays correct even
 * when this code itself is compiled/tested on a non-Windows dev machine -
 * `path.win32` always applies Windows path semantics regardless of the
 * host OS actually running Node.
 */
export function canonicalizeWindowsPath(rawPath: string): string {
  return path.win32.normalize(rawPath.trim()).toLowerCase();
}

/** Never treats two unknown/null paths as equal - an unconfirmed path is never assumed to match. */
export function windowsPathsEqual(a: string | null, b: string | null): boolean {
  if (a === null || b === null) {
    return false;
  }
  return canonicalizeWindowsPath(a) === canonicalizeWindowsPath(b);
}
