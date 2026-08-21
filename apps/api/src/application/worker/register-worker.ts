import { randomUUID } from "node:crypto";
import type { RegisterWorkerRequest, RegisterWorkerResponse } from "@dyo/schemas";
import type { WorkerRepository } from "../../domain/worker/types.js";

export interface RegisterWorkerDeps {
  repository: WorkerRepository;
  generateToken: () => string;
  hashToken: (token: string) => Promise<string>;
  now: () => Date;
}

/**
 * Registration itself is gated by a pairing secret checked at the route
 * layer (docs/engineering/SECURITY.md: "per-worker token/pairing token").
 * Every worker still gets its own unique ID and a token that is returned
 * exactly once and never stored in plaintext.
 */
export async function registerWorker(
  deps: RegisterWorkerDeps,
  request: RegisterWorkerRequest
): Promise<RegisterWorkerResponse> {
  const workerId = randomUUID();
  const workerToken = deps.generateToken();
  const tokenHash = await deps.hashToken(workerToken);

  await deps.repository.create(
    {
      id: workerId,
      name: request.name,
      tokenHash,
      maxConcurrency: request.maxConcurrency,
      capabilities: request.capabilities
    },
    deps.now()
  );

  return { workerId, workerToken };
}
