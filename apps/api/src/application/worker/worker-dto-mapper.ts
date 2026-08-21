import type { WorkerDto } from "@dyo/schemas";
import type { Worker } from "../../domain/worker/types.js";

/** Translates the internal domain entity into the versioned public contract. tokenHash never leaves this boundary. */
export function toWorkerDto(worker: Worker): WorkerDto {
  return {
    workerId: worker.id,
    name: worker.name,
    status: worker.status,
    lastHeartbeatAt: worker.lastHeartbeatAt ? worker.lastHeartbeatAt.toISOString() : null,
    aeStatus: worker.aeStatus,
    mcpStatus: worker.mcpStatus,
    aeVersion: worker.aeVersion,
    capabilities: worker.capabilities,
    maxConcurrency: worker.maxConcurrency,
    currentJobId: worker.currentJobId,
    createdAt: worker.createdAt.toISOString(),
    updatedAt: worker.updatedAt.toISOString()
  };
}
