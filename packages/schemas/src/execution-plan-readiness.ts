import type { ScenePlanEntry } from "./execution-plan.js";

/**
 * Single shared domain predicate for "is this plan ready to be approved" -
 * used by BOTH the real approve-execution-plan API (which must actually
 * refuse an unready plan, not just rely on the dashboard hiding a button)
 * and the dashboard's Overview tab (which must never claim a plan is
 * ready when the backend would refuse it). Keeping this in @dyo/schemas
 * (not apps/api or apps/web alone) is what lets both sides call the exact
 * same function rather than maintaining two copies of the same rule.
 *
 * Only scenes marked for use (`use: true`) count - an excluded scene's
 * own unresolvedReasons never block the plan, since it will never appear
 * in the final output. A scene's `unresolvedReasons` (populated once at
 * build time from the manifest - see build-execution-plan.ts) is the
 * existing, real signal for "this scene's structural/semantic mapping is
 * still unknown"; this function does not invent a second, competing
 * notion of "resolved".
 */
export interface ExecutionPlanReadiness {
  ready: boolean;
  unresolvedSceneCount: number;
  unresolvedScenePlanIds: string[];
}

export function getExecutionPlanReadiness(scenePlans: ScenePlanEntry[]): ExecutionPlanReadiness {
  const unresolved = scenePlans.filter((scene) => scene.use && scene.unresolvedReasons.length > 0);
  return {
    ready: unresolved.length === 0,
    unresolvedSceneCount: unresolved.length,
    unresolvedScenePlanIds: unresolved.map((scene) => scene.id)
  };
}
