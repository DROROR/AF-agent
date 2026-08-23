import type { z } from "zod";
import { inspectTemplateRequestSchema } from "./inspect-template.js";
import type { WorkerCapability } from "./worker.js";

/**
 * Per-operation job payload schema. Only operations with a real,
 * implemented request contract are listed - every other name in
 * WORKER_CAPABILITIES (worker.ts) is a recognized *operation name* but has
 * no payload schema yet, since no other operation's execution exists.
 * Never a free-form/arbitrary payload - every job's payload is validated
 * against exactly this, both at job creation and again when a worker
 * claims it (defense in depth across the API/worker boundary).
 */
export const JOB_PAYLOAD_SCHEMAS: Partial<Record<WorkerCapability, z.ZodTypeAny>> = {
  INSPECT_TEMPLATE: inspectTemplateRequestSchema
};

export function hasJobPayloadSchema(operation: WorkerCapability): boolean {
  return operation in JOB_PAYLOAD_SCHEMAS;
}

/** Throws (via the schema's own ZodError) if payload doesn't match the operation's contract, or if the operation has no registered payload schema at all. */
export function validateJobPayload(operation: WorkerCapability, payload: unknown): unknown {
  const schema = JOB_PAYLOAD_SCHEMAS[operation];
  if (!schema) {
    throw new Error(`No job payload schema is registered for operation "${operation}" yet`);
  }
  return schema.parse(payload);
}
