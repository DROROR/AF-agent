import type { WorkerDto } from "@dyo/schemas";
import type { WorkerRepository } from "../../domain/worker/types.js";
import { sweepStaleWorkers } from "./sweep-stale-workers.js";
import { toWorkerDto } from "./worker-dto-mapper.js";

export interface ListWorkersDeps {
  repository: WorkerRepository;
  now: () => Date;
  staleAfterMs: number;
}

export async function listWorkers(deps: ListWorkersDeps): Promise<WorkerDto[]> {
  await sweepStaleWorkers(deps);
  const workers = await deps.repository.findAll();
  return workers.map(toWorkerDto);
}
