import { UnsafePathError } from "../errors/worker-error.js";

/**
 * Defense-in-depth for every worker-derived render/preview output
 * filename (full-preview-output-path.ts / render-output-path.ts) - live
 * QA, 2026-09-10 real incident audit (session dac9fc90, job
 * dac9fc90-ed8b-4589-9fe5-d34d4f95aa95). The real failure that day was a
 * mismatched Render Settings template name ("best setting" persisted vs.
 * the real AE template "Best Settings"), never an empty basename - the
 * actual output filename passed to aerender was always the well-formed
 * constant "preview.mp4", confirmed both from the durable job result and
 * from the source itself. But nothing in this codebase actually asserted
 * that could never happen; this closes that gap structurally, not merely
 * "by construction" (a hardcoded string literal today, but nothing
 * stopped a future change from making it dynamic and silently empty,
 * whitespace-only, or missing its extension).
 *
 * Called every time an output path is computed (immediately before
 * `safeJoin`, i.e. before aerender is ever spawned) - "validate basename
 * before spawning aerender." Returns the (trimmed) basename unchanged on
 * success; throws UnsafePathError, never silently substitutes/clamps, on
 * any of:
 *   - empty or whitespace-only,
 *   - contains a path separator ("/" or "\") or a null byte - a basename
 *     is one path SEGMENT, never a sub-path, and never "traverses" via a
 *     "." or ".." component,
 *   - does not end with the expected extension (case-insensitive),
 *   - is ONLY the extension, with no real name before it (the exact
 *     shape of the operator's own reported incident path -
 *     "...\preview\.mp4" - a basename of just ".mp4" with nothing before
 *     the dot),
 *   - the expected extension appears more than once at the end (e.g.
 *     "preview.mp4.mp4") - "normalize extension exactly once."
 */
export function assertValidOutputBasename(basename: string, expectedExtension: string): string {
  const trimmed = basename.trim();
  if (trimmed.length === 0) {
    throw new UnsafePathError(`Output basename is empty or whitespace-only: ${JSON.stringify(basename)}`, "invalid-segment");
  }
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    throw new UnsafePathError(`Output basename contains a path separator or null byte: ${JSON.stringify(basename)}`, "invalid-segment");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new UnsafePathError(`Output basename is a path traversal segment: ${JSON.stringify(basename)}`, "traversal");
  }

  const ext = expectedExtension.startsWith(".") ? expectedExtension : `.${expectedExtension}`;
  if (!trimmed.toLowerCase().endsWith(ext.toLowerCase())) {
    throw new UnsafePathError(`Output basename does not end with the expected extension "${ext}": ${JSON.stringify(basename)}`, "invalid-segment");
  }

  const namePart = trimmed.slice(0, trimmed.length - ext.length);
  if (namePart.length === 0) {
    throw new UnsafePathError(`Output basename is only an extension, with no real name before it: ${JSON.stringify(basename)}`, "invalid-segment");
  }
  if (namePart.toLowerCase().endsWith(ext.toLowerCase())) {
    throw new UnsafePathError(`Output basename has the extension "${ext}" more than once: ${JSON.stringify(basename)}`, "invalid-segment");
  }

  return trimmed;
}
