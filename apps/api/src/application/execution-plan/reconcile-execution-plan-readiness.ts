import type { ReconcileExecutionPlanReadinessResponse, RowApprovalState } from "@dyo/schemas";
import { ExecutionPlanNotFoundError, StaleExecutionPlanRevisionError } from "../../errors/app-error.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import { computeSceneUnresolvedReasons } from "../../domain/execution-plan/compute-scene-unresolved-reasons.js";
import { toExecutionPlanResponse } from "./execution-plan-dto-mapper.js";

export interface ReconcileExecutionPlanReadinessDeps {
  executionPlanRepository: ExecutionPlanRepository;
  now: () => Date;
}

/**
 * Mapping-review -> execution-plan propagation fix, explicit one-time
 * reconciliation for a plan whose `unresolvedReasons`/`approvalState`
 * went stale BEFORE this fix existed (apply-execution-plan-edit.ts now
 * keeps every NEW edit in sync automatically - this is only for a plan
 * with edits that predate that fix, e.g. real production data like
 * test22).
 *
 * Deliberately narrow and safe:
 *   - Reuses the EXACT SAME pure computeSceneUnresolvedReasons function
 *     every live edit already uses - never a second, divergent notion of
 *     "resolved".
 *   - Touches ONLY `unresolvedReasons`/`approvalState` on each scene -
 *     never selectedAssetId/text/colorHex/instructions/use/finalOrder/
 *     anything else. No mapping content is ever altered.
 *   - Never downgrades an already-APPROVED/REJECTED scene (same sticky-
 *     human-decision rule apply-execution-plan-edit.ts's own
 *     withRecomputedReadiness already applies).
 *   - Never touches the PLAN's own status/approvedAt/approvedBy - a
 *     reconciled plan is still exactly as DRAFT/APPROVED/REJECTED as it
 *     was before; this can make a DRAFT plan become genuinely
 *     APPROVABLE, but it never approves it.
 *   - Idempotent and side-effect-free when nothing is actually stale: if
 *     every scene's live-recomputed values already match what is stored,
 *     `changed` is false and NO write is issued at all (not even a
 *     no-op update) - safe to call repeatedly, safe to call on a plan
 *     that was already fixed going forward.
 *   - Uses the SAME optimistic-concurrency (expectedRevision) write path
 *     as every other in-place plan update, so it can never silently
 *     clobber a concurrent real edit.
 */
export async function reconcileExecutionPlanReadiness(
  deps: ReconcileExecutionPlanReadinessDeps,
  projectId: string
): Promise<ReconcileExecutionPlanReadinessResponse> {
  const current = await deps.executionPlanRepository.findCurrentByProjectId(projectId);
  if (!current) {
    throw new ExecutionPlanNotFoundError(projectId);
  }

  const changedScenePlanIds: string[] = [];
  const recomputedScenePlans = current.scenePlans.map((scene) => {
    const unresolvedReasons = computeSceneUnresolvedReasons(scene);
    const approvalState: RowApprovalState =
      scene.approvalState === "APPROVED" || scene.approvalState === "REJECTED"
        ? scene.approvalState
        : unresolvedReasons.length === 0
          ? "READY_FOR_APPROVAL"
          : "UNREVIEWED";
    const unresolvedReasonsChanged =
      unresolvedReasons.length !== scene.unresolvedReasons.length || unresolvedReasons.some((reason, index) => reason !== scene.unresolvedReasons[index]);
    if (!unresolvedReasonsChanged && approvalState === scene.approvalState) {
      return scene;
    }
    changedScenePlanIds.push(scene.id);
    return { ...scene, unresolvedReasons, approvalState };
  });

  if (changedScenePlanIds.length === 0) {
    const response = toExecutionPlanResponse(current);
    return { changed: false, changedScenePlanIds: [], plan: response.plan, sceneTable: response.sceneTable };
  }

  const updated = await deps.executionPlanRepository.updateSceneReadiness(current.id, current.revision, recomputedScenePlans, deps.now());
  if (!updated) {
    throw new StaleExecutionPlanRevisionError(current.revision, current.revision);
  }
  const response = toExecutionPlanResponse(updated);
  return { changed: true, changedScenePlanIds, plan: response.plan, sceneTable: response.sceneTable };
}
