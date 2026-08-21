import type { WorkerDto } from "@dyo/schemas";
import { WorkerNotFoundError } from "../../errors/app-error.js";
import type { WorkerRepository } from "../../domain/worker/types.js";
import { sweepStaleWorkers } from "./sweep-stale-workers.js";
import { toWorkerDto } from "./worker-dto-mapper.js";

export interface GetWorkerDeps {
  repository: WorkerRepository;
  now: () => Date;
  staleAfterMs: number;
}

export async function getWorker(deps: GetWorkerDeps, workerId: string): Promise<WorkerDto> {
  await sweepStaleWorkers(deps);
  const worker = await deps.repository.findById(workerId);
  if (!worker) {
    throw new WorkerNotFoundError(workerId);
  }
  return toWorkerDto(worker);
}
