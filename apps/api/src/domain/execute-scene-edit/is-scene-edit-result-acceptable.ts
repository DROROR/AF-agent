import type { SceneEditResult } from "@dyo/schemas";

/**
 * Phase 7A section 7: "not considered successful from metadata alone" - a
 * real preview frame (path + timestamp) is required, and every requested
 * operation must have actually completed, before a scene-edit result can
 * be treated as done. No full-video render is ever required here.
 */
export function isSceneEditResultAcceptable(result: SceneEditResult): boolean {
  return (
    result.failureReason === null &&
    result.previewFramePath !== null &&
    result.previewTimestampSeconds !== null &&
    result.operationsCompleted.length === result.operationsRequested
  );
}
