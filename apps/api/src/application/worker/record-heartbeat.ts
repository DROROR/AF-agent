import type { HeartbeatRequest, WorkerDto } from "@dyo/schemas";
import { UnauthorizedError, WorkerNotFoundError } from "../../errors/app-error.js";
import type { WorkerRepository } from "../../domain/worker/types.js";
import { toWorkerDto } from "./worker-dto-mapper.js";

export interface RecordHeartbeatDeps {
  repository: WorkerRepository;
  verifyToken: (token: string, storedHash: string) => Promise<boolean>;
  now: () => Date;
}

export async function recordHeartbeat(
  deps: RecordHeartbeatDeps,
  workerId: string,
  token: string,
  request: HeartbeatRequest
): Promise<WorkerDto> {
  const worker = await deps.repository.findById(workerId);
  if (!worker) {
    // Same response as an invalid token: do not reveal whether a worker ID exists.
    throw new UnauthorizedError("Invalid worker credentials");
  }

  const validToken = await deps.verifyToken(token, worker.tokenHash);
  if (!validToken) {
    throw new UnauthorizedError("Invalid worker credentials");
  }

  const updated = await deps.repository.updateHeartbeat(
    workerId,
    {
      aeStatus: request.aeStatus,
      mcpStatus: request.mcpStatus,
      aeVersion: request.aeVersion,
      ...(request.capabilities ? { capabilities: request.capabilities } : {}),
      ...(request.maxConcurrency ? { maxConcurrency: request.maxConcurrency } : {}),
      currentJobId: request.currentJobId
    },
    deps.now()
  );

  if (!updated) {
    throw new WorkerNotFoundError(workerId);
  }

  return toWorkerDto(updated);
}
