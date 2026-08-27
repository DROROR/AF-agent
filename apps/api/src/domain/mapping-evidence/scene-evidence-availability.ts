import type { SceneEvidenceStatus } from "@dyo/schemas";
import type { SceneEvidenceRecord } from "../scene-evidence/types.js";

/**
 * Per-scene honest status for the dashboard (evidence-persistence phase
 * section 7): AVAILABLE when a compatible (current-SHA) record exists and
 * is actually usable as FACT input; STALE when evidence exists for this
 * scene but only against a source SHA that no longer matches (retained
 * historically, never used as current fact - section 3); NOT_INSPECTED
 * when no evidence has ever been captured. Every scene in `scenePlans`
 * gets an entry - a scene never simply absent from the result, since
 * "never inspected" is itself a status this function must report, not omit.
 */
export function buildSceneEvidenceAvailability(
  scenePlans: { manifestCompositionId: string }[],
  compatibleRows: SceneEvidenceRecord[],
  latestRows: SceneEvidenceRecord[]
): Record<string, SceneEvidenceStatus> {
  const compatibleIds = new Set(compatibleRows.map((row) => row.manifestCompositionId));
  const everInspectedIds = new Set(latestRows.map((row) => row.manifestCompositionId));

  const result: Record<string, SceneEvidenceStatus> = {};
  for (const scene of scenePlans) {
    result[scene.manifestCompositionId] = compatibleIds.has(scene.manifestCompositionId)
      ? "AVAILABLE"
      : everInspectedIds.has(scene.manifestCompositionId)
        ? "STALE"
        : "NOT_INSPECTED";
  }
  return result;
}
