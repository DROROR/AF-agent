import type { ExecutionSessionDto } from "@dyo/schemas";
import { deriveExecutionSessionStatus } from "../../domain/execution-session/derive-status.js";
import type { ExecutionSessionRepository } from "../../domain/execution-session/types.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import { ExecutionSessionNotFoundError, PreconditionNotMetError } from "../../errors/app-error.js";
import { toExecutionSessionDto } from "./execution-session-dto-mapper.js";

export interface ApproveFirstPreviewDeps {
  executionSessionRepository: ExecutionSessionRepository;
  executionPlanRepository: ExecutionPlanRepository;
  now: () => Date;
}

/**
 * "Approve Preview" (section 10/14) - the one human gate between a
 * session's first completed scene edit and every scene after it. Only
 * valid while the session is genuinely AWAITING_PREVIEW_APPROVAL (at least
 * one scene has completed, no approval yet) - refuses otherwise rather
 * than silently no-op'ing (never allows "approving" a session that hasn't
 * produced a preview yet, and never re-approves one that's already past
 * this gate).
 */
export async function approveFirstPreview(deps: ApproveFirstPreviewDeps, projectId: string, sessionId: string): Promise<ExecutionSessionDto> {
  const session = await deps.executionSessionRepository.findById(sessionId);
  if (!session || session.projectId !== projectId) {
    throw new ExecutionSessionNotFoundError(sessionId);
  }
  if (session.status !== "AWAITING_PREVIEW_APPROVAL") {
    throw new PreconditionNotMetError(`Execution session is ${session.status}, not AWAITING_PREVIEW_APPROVAL - nothing to approve`);
  }

  const plan = await deps.executionPlanRepository.findCurrentByProjectId(projectId);
  if (!plan || plan.revision !== session.planRevision || plan.sourceProjectSha256 !== session.sourceProjectSha256) {
    // Fails closed rather than approving against an empty/stale required-
    // scene set (an empty array would otherwise vacuously satisfy
    // deriveExecutionSessionStatus's "every required scene complete" check
    // below) - same "the plan changed after this session began; start a
    // new execution session" rule resolveExecuteFrameDispatch/
    // resolveRenderDispatch already enforce.
    throw new PreconditionNotMetError(
      "The execution plan has changed since this session began - approval refused; start a new execution session from the current plan revision"
    );
  }
  const requiredScenePlanIds = plan.scenePlans
    .filter((s) => s.use && s.approvalState === "APPROVED" && s.unresolvedReasons.length === 0)
    .map((s) => s.id);

  const nextStatus = deriveExecutionSessionStatus({
    requiredScenePlanIds,
    completedScenePlanIds: session.completedScenePlanIds,
    firstPreviewApproved: true
  });

  const updated = await deps.executionSessionRepository.approvePreview(sessionId, nextStatus, deps.now());
  if (!updated) {
    throw new ExecutionSessionNotFoundError(sessionId);
  }
  return toExecutionSessionDto(updated);
}
