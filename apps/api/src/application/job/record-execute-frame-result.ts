import { sceneEditResultSchema, type JobDto } from "@dyo/schemas";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";

export interface RecordExecuteFrameResultDeps {
  executionPlanRepository: ExecutionPlanRepository;
  now: () => Date;
}

/**
 * Called after a worker's job-status report has already been durably
 * applied (reportJobStatus succeeded) - never a second, competing write
 * path for the job's own status/result, mirroring record-scene-evidence.ts/
 * record-render-artifact.ts's own doc comment verbatim. Only a job with
 * `status: "SUCCEEDED"`, operation `EXECUTE_FRAME`, a real `projectId`, and
 * a `result` that parses through the SAME strict sceneEditResultSchema the
 * worker's own contract uses - AND whose `failureReason` is null with both
 * working-copy fields present - ever updates the plan's durably-tracked
 * working-copy identity (activation-phase RENDER dispatch's own
 * prerequisite - see resolve-render-dispatch.ts).
 *
 * In-place update on the CURRENT plan revision - never bumps revision,
 * same rationale as set-render-output-config.ts. Known, accepted scope
 * limit (see schema.ts's own doc comment on this column): this always
 * reflects whichever EXECUTE_FRAME job most recently succeeded, not a
 * cumulative multi-scene edit session - real cross-scene continuity is a
 * separate, not-yet-solved architecture question.
 */
export async function recordExecuteFrameResultIfApplicable(deps: RecordExecuteFrameResultDeps, job: JobDto): Promise<void> {
  if (job.operation !== "EXECUTE_FRAME" || job.status !== "SUCCEEDED") {
    return;
  }
  if (!job.projectId) {
    return;
  }

  const parsed = sceneEditResultSchema.safeParse(job.result);
  if (!parsed.success) {
    return;
  }
  const result = parsed.data;
  if (result.failureReason !== null || !result.workingProjectPath || !result.workingProjectSha256) {
    return;
  }

  const plan = await deps.executionPlanRepository.findCurrentByProjectId(job.projectId);
  if (!plan) {
    return;
  }

  await deps.executionPlanRepository.updateWorkingCopy(plan.id, result.workingProjectPath, result.workingProjectSha256, deps.now());
}
