import { randomUUID } from "node:crypto";
import type { WorkerCapability } from "@dyo/schemas";
import { validateJobPayload } from "@dyo/schemas";
import type { JobRepository } from "../../domain/job/types.js";

export interface CreateJobDeps {
  jobRepository: JobRepository;
  now: () => Date;
}

export interface CreateJobRequest {
  workerId: string;
  operation: WorkerCapability;
  payload: unknown;
}

/**
 * Not exposed as a public HTTP route yet - job creation (who is allowed to
 * request INSPECT_TEMPLATE, and when) is a dashboard/approval-workflow
 * concern for a later phase. This exists now so the claim/report transport
 * built in this phase has something real to exercise in tests, and so a
 * later phase's route layer has a ready application-layer function to call
 * rather than reimplementing payload validation.
 *
 * Payload is validated against the operation's own schema here - the API
 * boundary - and is validated again independently by the worker before
 * execution (defense in depth across the API/worker boundary).
 */
export async function createJob(deps: CreateJobDeps, request: CreateJobRequest) {
  const validatedPayload = validateJobPayload(request.operation, request.payload);

  return deps.jobRepository.create(
    {
      id: randomUUID(),
      workerId: request.workerId,
      operation: request.operation,
      payload: validatedPayload
    },
    deps.now()
  );
}
