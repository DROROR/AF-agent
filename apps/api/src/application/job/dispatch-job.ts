import type { DispatchJobRequest, DispatchJobResponse } from "@dyo/schemas";
import { isHeartbeatStale } from "../../domain/worker/rules.js";
import { canClaimAnotherJob } from "../../domain/job/rules.js";
import type { JobRepository } from "../../domain/job/types.js";
import type { WorkerRepository } from "../../domain/worker/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { AssetRepository } from "../../domain/asset/types.js";
import {
  PreconditionNotMetError,
  ProjectNotFoundError,
  WorkerBusyError,
  WorkerNotFoundError,
  WorkerOfflineError
} from "../../errors/app-error.js";
import { sweepStaleWorkers } from "../worker/sweep-stale-workers.js";
import { resolveExecuteFrameDispatch } from "../../domain/execute-frame-dispatch/resolve-execute-frame-dispatch.js";
import { resolveRenderDispatch } from "../../domain/render-dispatch/resolve-render-dispatch.js";
import { createJob } from "./create-job.js";

export interface DispatchJobDeps {
  jobRepository: JobRepository;
  workerRepository: WorkerRepository;
  projectRepository: ProjectRepository;
  executionPlanRepository: ExecutionPlanRepository;
  assetRepository: AssetRepository;
  now: () => Date;
  staleAfterMs: number;
}

/** Every operation whose worker execution touches ae-mcp/AE at all - never dispatched unless the worker's most recent heartbeat confirmed both ONLINE. CHECK_HEALTH is deliberately exempt (its whole purpose is diagnosing a disagreement in that exact status). */
const AE_MCP_DEPENDENT_OPERATIONS = new Set<DispatchJobRequest["operation"]>([
  "INSPECT_TEMPLATE",
  "INSPECT_SCENE_EVIDENCE",
  "INSPECT_RENDER_CAPABILITIES",
  "EXECUTE_FRAME",
  "RENDER"
]);

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
 *
 * EXECUTE_FRAME/RENDER never trust `request` for anything beyond the
 * caller's minimal intent (workerId/projectId/scenePlanId or variant) -
 * the real worker-facing payload is entirely resolved here from freshly-
 * read project/plan/asset/worker state via resolveExecuteFrameDispatch/
 * resolveRenderDispatch (activation-phase sections 2-4: "no arbitrary
 * worker payload passthrough from the browser").
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
  if (AE_MCP_DEPENDENT_OPERATIONS.has(request.operation)) {
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

  // Every project-bound operation's projectId is verified real here, at
  // dispatch time, rather than trusted blindly through to job completion -
  // same rationale as INSPECT_SCENE_EVIDENCE's own pre-existing check.
  const project =
    request.operation === "INSPECT_SCENE_EVIDENCE" || request.operation === "EXECUTE_FRAME" || request.operation === "RENDER"
      ? await deps.projectRepository.findById(request.projectId)
      : null;
  if ((request.operation === "INSPECT_SCENE_EVIDENCE" || request.operation === "EXECUTE_FRAME" || request.operation === "RENDER") && !project) {
    throw new ProjectNotFoundError(request.projectId);
  }

  // Duplicate-dispatch check first (a more specific signal than plain
  // busy): refuses a second live job of this exact operation for this
  // worker even on a worker whose maxConcurrency could otherwise fit it.
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

  let payload: unknown;
  let projectId: string | null = null;

  if (request.operation === "EXECUTE_FRAME") {
    if (!project) {
      throw new ProjectNotFoundError(request.projectId);
    }
    projectId = request.projectId;
    const plan = await deps.executionPlanRepository.findCurrentByProjectId(request.projectId);
    const projectAssets = await deps.assetRepository.listByProjectId(request.projectId);
    const resolved = resolveExecuteFrameDispatch({
      projectId: request.projectId,
      scenePlanId: request.scenePlanId,
      currentPlan: plan,
      currentProjectManifest: project.manifest,
      projectAssets,
      worker,
      now,
      staleAfterMs: deps.staleAfterMs
    });
    if (!resolved.ok) {
      throw new PreconditionNotMetError(resolved.reason);
    }
    payload = { ...resolved.payload, checkpoint: null };
  } else if (request.operation === "RENDER") {
    if (!project) {
      throw new ProjectNotFoundError(request.projectId);
    }
    projectId = request.projectId;
    const plan = await deps.executionPlanRepository.findCurrentByProjectId(request.projectId);
    const resolved = resolveRenderDispatch({
      projectId: request.projectId,
      variant: request.variant,
      currentPlan: plan,
      currentProjectSourceProjectSha256: project.sourceProjectSha256,
      currentProjectSourceProjectPath: project.manifest.sourceProject.path,
      worker,
      now,
      staleAfterMs: deps.staleAfterMs
    });
    if (!resolved.ok) {
      throw new PreconditionNotMetError(resolved.reason);
    }
    payload = { ...resolved.payload, checkpoint: null };
  } else if (request.operation === "INSPECT_SCENE_EVIDENCE") {
    projectId = request.projectId;
    payload = request.payload;
  } else {
    payload = request.payload;
  }

  const job = await createJob(
    { jobRepository: deps.jobRepository, now: deps.now },
    {
      workerId: worker.id,
      projectId,
      operation: request.operation,
      payload
    }
  );

  return {
    jobId: job.id,
    workerId: job.workerId,
    operation: request.operation,
    status: job.status,
    createdAt: job.createdAt.toISOString()
  };
}
