import type { CurrentProjectInfo } from "./parse-mcp-shapes.js";

/**
 * Decides whether opening the target project would raise a modal
 * save-changes prompt in After Effects, from evidence ae_health has already
 * returned.
 *
 * REAL 2026-09-12 INCIDENT (jobs 48bf41d3, 77c84bcd and two more the same
 * day): ae_health reported
 * `projectOpen: true, projectPath: null, projectName: "Untitled", numItems: 46`
 * - After Effects was holding a project with real content that had never been
 * saved. app.open() against a dirty, never-saved project makes AE raise a
 * modal "save changes?" prompt, which blocks the scripting bridge entirely:
 * system.runJsx timed out after 30s and every inspection degraded to a raw
 * capture with an opaque MANIFEST_NOT_BUILT. app.beginSuppressDialogs cannot
 * help, because the script never gets to run.
 *
 * WHY THIS REFUSES RATHER THAN CLOSING THE PROJECT: closing it would discard
 * unsaved human work. CLAUDE.md Safety Rule 1 protects the source .aep by
 * name, but its intent - never destroy the human's input - covers this just
 * as squarely. Only the person who made that work can decide whether to keep
 * it, so the worker stops and says exactly what to do.
 */
export interface UnsavedProjectBlock {
  blocked: boolean;
  /** Present only when blocked - the exact operator-facing explanation and instruction. */
  reason?: string;
  projectName?: string;
  itemCount?: number;
}

export function assessUnsavedProjectBlock(current: CurrentProjectInfo): UnsavedProjectBlock {
  // Not open at all: nothing can prompt.
  if (!current.projectOpen) {
    return { blocked: false };
  }
  // Has a real path: it is a SAVED project. Re-opening over it does not
  // prompt (AE only prompts about unsaved changes, and a saved project's
  // changes are the operator's own business, not detectable from here).
  if (current.projectPath !== null) {
    return { blocked: false };
  }
  // Never saved AND positively known to hold at least one item. AE's empty
  // default project (numItems 0) is replaced silently with no prompt.
  //
  // A NULL count is deliberately NOT treated as blocked: ae_health did not
  // report it, and refusing to work on absent evidence would strand every
  // inspection on a bridge version that omits the field. Guessing the other
  // way costs one 30s timeout and a clear failure, which is recoverable;
  // guessing this way would block everything permanently.
  const itemCount = current.numItems;
  if (itemCount === null || itemCount <= 0) {
    return { blocked: false };
  }

  const projectName = current.projectName ?? "an untitled project";
  return {
    blocked: true,
    projectName,
    itemCount,
    reason:
      `After Effects currently has "${projectName}" open with ${itemCount} item(s), and it has never been saved. ` +
      `Opening the requested project would make After Effects show a "save changes?" dialog, which blocks all scripting until a human answers it. ` +
      `No open was attempted and nothing was changed. ` +
      `OPERATOR ACTION: in After Effects, either save that project or close it (File > Close Project) and choose whether to keep it - then re-run this inspection. ` +
      `This worker will not close it for you, because it contains unsaved work that only you can decide to keep or discard.`
  };
}
