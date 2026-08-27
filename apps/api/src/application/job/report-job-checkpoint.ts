import { sceneEditCheckpointSchema, type JobDto, type SceneEditCheckpoint } from "@dyo/schemas";
import { JobConflictError, JobNotFoundError, UnauthorizedError } from "../../errors/app-error.js";
import type { JobRepository } from "../../domain/job/types.js";
import type { WorkerRepository } from "../../domain/worker/types.js";
import { toJobDto } from "./job-dto-mapper.js";

export interface ReportJobCheckpointDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  verifyToken: (token: string, storedHash: string) => Promise<boolean>;
  now: () => Date;
}

/**
 * A worker durably persisting MID-JOB progress on its own claimed,
 * currently-RUNNING job - deliberately separate from reportJobStatus
 * (report-job-status.ts), which owns status transitions. This function
 * NEVER changes a job's status; it only ever updates `checkpoint` on a
 * job that is already RUNNING, and only forward (see the monotonicity
 * check below) - see docs comment on JobRepository.updateCheckpoint.
 *
 * Scoped to EXECUTE_FRAME only for now (the only operation with real
 * checkpoint semantics today - see execute-scene-edit.ts's own
 * sceneEditCheckpointSchema) - a future operation with its own checkpoint
 * shape would need its own validation branch here, never a generic
 * unchecked passthrough.
 */
export async function reportJobCheckpoint(
  deps: ReportJobCheckpointDeps,
  workerId: string,
  jobId: string,
  token: string,
  checkpoint: unknown
): Promise<JobDto> {
  const worker = await deps.workerRepository.findById(workerId);
  if (!worker) {
    throw new UnauthorizedError("Invalid worker credentials");
  }

  const validToken = await deps.verifyToken(token, worker.tokenHash);
  if (!validToken) {
    throw new UnauthorizedError("Invalid worker credentials");
  }

  const existing = await deps.jobRepository.findById(jobId);
  if (!existing || existing.workerId !== workerId) {
    // Same shape whether the job doesn't exist or simply isn't this
    // worker's - see reportJobStatus's own identical reasoning.
    throw new JobNotFoundError(jobId);
  }

  if (existing.status !== "RUNNING") {
    throw new JobConflictError(`Job ${jobId} is not RUNNING (current status: ${existing.status}) - checkpoint updates are only accepted while a job is running`);
  }

  // EXECUTE_FRAME and RENDER share the exact same checkpoint shape/algebra
  // (sceneEditCheckpointSchema - see render-project.ts's own doc comment on
  // why RENDER reuses it rather than inventing a parallel type), so both
  // are accepted here without any per-operation schema branching.
  if (existing.operation !== "EXECUTE_FRAME" && existing.operation !== "RENDER") {
    throw new JobConflictError(`Job ${jobId}'s operation (${existing.operation}) does not define checkpoint semantics - only EXECUTE_FRAME and RENDER do today`);
  }

  const parsedNew = sceneEditCheckpointSchema.safeParse(checkpoint);
  if (!parsedNew.success) {
    throw new JobConflictError(`Malformed checkpoint: ${parsedNew.error.message}`);
  }

  // Monotonic: a checkpoint update may only ever ADD completed operation
  // indices, never remove one already recorded - this is the safety net
  // that makes "which physical attempt sent this" irrelevant without
  // needing a lease/fencing-token concept this job model doesn't have.
  const existingParsed = sceneEditCheckpointSchema.safeParse(existing.checkpoint);
  const existingCompleted = new Set(existingParsed.success ? existingParsed.data.completedOperationIndices : []);
  const newCompleted: SceneEditCheckpoint["completedOperationIndices"] = parsedNew.data.completedOperationIndices;
  const isSupersetOrEqual = [...existingCompleted].every((index) => newCompleted.includes(index));
  if (!isSupersetOrEqual) {
    throw new JobConflictError(
      `Checkpoint regression rejected: the new checkpoint's completed operations (${JSON.stringify(newCompleted)}) do not include all of the already-recorded ones (${JSON.stringify([...existingCompleted])})`
    );
  }

  const updated = await deps.jobRepository.updateCheckpoint(jobId, workerId, parsedNew.data, deps.now());
  if (!updated) {
    // The job changed underneath us before the write landed (finished,
    // failed, or reassigned by the time this ran) - a real conflict, not
    // a silent success.
    throw new JobConflictError(`Job ${jobId} is no longer RUNNING under this worker - checkpoint was not applied`);
  }

  return toJobDto(updated);
}
