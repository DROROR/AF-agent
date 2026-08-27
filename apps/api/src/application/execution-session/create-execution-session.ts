import { randomUUID } from "node:crypto";
import type { ExecutionSessionDto } from "@dyo/schemas";
import { isHeartbeatStale } from "../../domain/worker/rules.js";
import { isSessionActive } from "../../domain/execution-session/is-session-active.js";
import type { ExecutionSessionRepository } from "../../domain/execution-session/types.js";
import type { ExecutionPlanRepository } from "../../domain/execution-plan/types.js";
import type { ProjectRepository } from "../../domain/project/types.js";
import type { WorkerRepository } from "../../domain/worker/types.js";
import { ExecutionPlanNotFoundError, PreconditionNotMetError, ProjectNotFoundError, WorkerNotFoundError, WorkerOfflineError } from "../../errors/app-error.js";
import { toExecutionSessionDto } from "./execution-session-dto-mapper.js";

export interface CreateExecutionSessionDeps {
  executionSessionRepository: ExecutionSessionRepository;
  executionPlanRepository: ExecutionPlanRepository;
  projectRepository: ProjectRepository;
  workerRepository: WorkerRepository;
  now: () => Date;
  staleAfterMs: number;
}

/**
 * "Start Execution" (multi-scene-accumulation phase, section 2/14) -
 * idempotent by design: if an active session already exists for the
 * project's CURRENT plan revision, returns it unchanged (never creates a
 * second one, regardless of which workerId this call requested - worker
 * affinity was already established when that session was first created).
 * Only creates a genuinely NEW session when no active one exists for the
 * current revision (section 11: an old session bound to a stale revision
 * is simply left behind, never auto-migrated).
 *
 * The requested worker is verified the exact same way dispatch-job.ts
 * verifies one for EXECUTE_FRAME/RENDER (ONLINE, fresh heartbeat, reports
 * EXECUTE_FRAME - the minimum capability any session needs) - this is the
 * ONE place a worker is ever chosen for a session; every later scene-edit/
 * render dispatch is pinned to it (section 8).
 */
export async function createExecutionSession(deps: CreateExecutionSessionDeps, projectId: string, workerId: string): Promise<ExecutionSessionDto> {
  const project = await deps.projectRepository.findById(projectId);
  if (!project) {
    throw new ProjectNotFoundError(projectId);
  }

  const plan = await deps.executionPlanRepository.findCurrentByProjectId(projectId);
  if (!plan) {
    throw new ExecutionPlanNotFoundError(projectId);
  }
  if (plan.status !== "APPROVED") {
    throw new PreconditionNotMetError(`Plan is ${plan.status}, not APPROVED - an execution session can only be started from an approved plan`);
  }
  if (project.sourceProjectSha256 !== plan.sourceProjectSha256) {
    throw new PreconditionNotMetError("The project's current manifest sha256 no longer matches this plan - the source project may have changed");
  }

  const existing = await deps.executionSessionRepository.findLatestByProjectId(projectId);
  if (existing && isSessionActive(existing, plan.revision)) {
    return toExecutionSessionDto(existing);
  }

  const now = deps.now();
  const worker = await deps.workerRepository.findById(workerId);
  if (!worker) {
    throw new WorkerNotFoundError(workerId);
  }
  if (worker.status !== "ONLINE" || isHeartbeatStale(worker.lastHeartbeatAt, now, deps.staleAfterMs)) {
    throw new WorkerOfflineError(worker.id);
  }
  if (!worker.capabilities.includes("EXECUTE_FRAME")) {
    throw new PreconditionNotMetError(`Worker ${worker.id} does not report the EXECUTE_FRAME capability`);
  }

  const created = await deps.executionSessionRepository.create(
    {
      id: randomUUID(),
      projectId,
      executionPlanId: plan.id,
      planRevision: plan.revision,
      sourceProjectSha256: plan.sourceProjectSha256,
      assignedWorkerId: worker.id
    },
    now
  );
  return toExecutionSessionDto(created);
}
