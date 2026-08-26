import type { DispatchJobRequest, DispatchJobResponse } from "@dyo/schemas";
import { isHeartbeatStale } from "../../domain/worker/rules.js";
import { canClaimAnotherJob } from "../../domain/job/rules.js";
import type { JobRepository } from "../../domain/job/types.js";
import type { WorkerRepository } from "../../domain/worker/types.js";
import { PreconditionNotMetError, WorkerBusyError, WorkerNotFoundError, WorkerOfflineError } from "../../errors/app-error.js";
import { sweepStaleWorkers } from "../worker/sweep-stale-workers.js";
import { createJob } from "./create-job.js";

export interface DispatchJobDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  now: () => Date;
  staleAfterMs: number;
}

/**
 * The one production-safe entry point that turns a dashboard operator's
 * request into a real queued job (POST /api/jobs - see routes/jobs.ts).
 * Every gate below re-reads LIVE worker state after sweeping stale
 * heartbeats first - it never trusts a cached "ONLINE" DB row alone
 * (Phase 5 requirement: "Do not trust stale DB status alone"; see also
 * CLAUDE.md Safety Rule 9, "pause safely instead of endless retries").
 *
 * Actual job creation is delegated entirely to create-job.ts - this
 * function only decides whether it is safe to call it, it never inserts a
 * job row itself.
 */
export async function dispatchJob(deps: DispatchJobDeps, request: DispatchJobRequest): Promise<DispatchJobResponse> {
  await sweepStaleWorkers({ repository: deps.workerRepository, now: deps.now, staleAfterMs: deps.staleAfterMs });

  const worker = await deps.workerRepository.findById(request.workerId);
  if (!worker) {
    throw new WorkerNotFoundError(request.workerId);
  }

  const now = deps.now();
  if (worker.status !== "ONLINE" || isHeartbeatStale(worker.lastHeartbeatAt, now, deps.staleAfterMs)) {
    throw new WorkerOfflineError(worker.id);
  }
  // AE/MCP-ONLINE preconditions apply only to operations that actually
  // touch ae-mcp/AE (INSPECT_TEMPLATE). CHECK_HEALTH is deliberately
  // exempt: its whole purpose is to remotely diagnose why AE/MCP status
  // disagrees with reality, so requiring either to already be ONLINE
  // would make it useless exactly when it's needed most.
  if (request.operation === "INSPECT_TEMPLATE") {
    if (worker.aeStatus !== "ONLINE") {
      throw new PreconditionNotMetError(
        `Worker ${worker.id} reports After Effects status "${worker.aeStatus}", not ONLINE`
      );
    }
    if (worker.mcpStatus !== "ONLINE") {
      throw new PreconditionNotMetError(`Worker ${worker.id} reports MCP status "${worker.mcpStatus}", not ONLINE`);
    }
  }
  if (!worker.capabilities.includes(request.operation)) {
    throw new PreconditionNotMetError(`Worker ${worker.id} does not report the ${request.operation} capability`);
  }

  // Duplicate-dispatch check first (a more specific signal than plain
  // busy): refuses a second live INSPECT_TEMPLATE job for this worker
  // even on a worker whose maxConcurrency could otherwise fit it.
  const hasDuplicate = await deps.jobRepository.hasNonTerminalJobForOperation(worker.id, request.operation);
  if (hasDuplicate) {
    throw new WorkerBusyError(`Worker ${worker.id} already has a live ${request.operation} job in progress`);
  }

  // currentJobId is the worker's own self-reported state (set via
  // heartbeat); the active-job count is the actual source of truth in the
  // jobs table. Checking both is cheap defense in depth - see Phase 5's
  // explicit "currentJobId is empty" and "maxConcurrency allows the job"
  // gates.
  const activeCount = await deps.jobRepository.countActiveForWorker(worker.id);
  if (worker.currentJobId !== null || !canClaimAnotherJob(activeCount, worker.maxConcurrency)) {
    throw new WorkerBusyError(`Worker ${worker.id} is already at its concurrency limit`);
  }

  const job = await createJob(
    { jobRepository: deps.jobRepository, now: deps.now },
    { workerId: worker.id, operation: request.operation, payload: request.payload }
  );

  return {
    jobId: job.id,
    workerId: job.workerId,
    operation: request.operation,
    status: job.status,
    createdAt: job.createdAt.toISOString()
  };
}
