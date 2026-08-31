import type { z } from "zod";
import { checkHealthRequestSchema } from "./check-health.js";
import { inspectTemplateRequestSchema } from "./inspect-template.js";
import { sceneEvidenceRequestSchema } from "./scene-evidence.js";
import { executeSceneEditRequestSchema } from "./execute-scene-edit.js";
import { renderProjectRequestSchema } from "./render-project.js";
import { createFullPreviewRequestSchema } from "./create-full-preview.js";
import { inspectRenderCapabilitiesRequestSchema } from "./inspect-render-capabilities.js";
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
  INSPECT_TEMPLATE: inspectTemplateRequestSchema,
  CHECK_HEALTH: checkHealthRequestSchema,
  INSPECT_SCENE_EVIDENCE: sceneEvidenceRequestSchema,
  // Registered here (the worker's own defense-in-depth re-validation
  // dependency - see job-dispatcher.ts) without also adding EXECUTE_FRAME
  // to job-dispatch.ts's DISPATCHABLE_OPERATIONS - the dashboard/
  // control-plane dispatch surface is deliberately untouched this phase;
  // this operation is exercised directly (unit/integration tests
  // constructing a JobDto by hand), never through POST /api/jobs, until a
  // later phase wires real dispatch.
  EXECUTE_FRAME: executeSceneEditRequestSchema,
  // Same "not yet on job-dispatch.ts's DISPATCHABLE_OPERATIONS" convention
  // as EXECUTE_FRAME above - the dashboard/control-plane dispatch surface
  // stays untouched this phase; RENDER is exercised directly (unit/
  // integration tests constructing a JobDto by hand), never through
  // POST /api/jobs, until a later phase wires real dispatch.
  RENDER: renderProjectRequestSchema,
  INSPECT_RENDER_CAPABILITIES: inspectRenderCapabilitiesRequestSchema,
  // Client-handoff phase, "real final preview approval gate": the first
  // real implementation of a previously reserved/planned-only capability
  // (see worker.ts's own WORKER_CAPABILITIES doc comment) - registered
  // here (and in job-dispatch.ts's DISPATCHABLE_OPERATIONS) so the real
  // API/dashboard contract exists end to end. No real Worker build
  // reports this capability yet - see resolve-create-full-preview-dispatch.ts's
  // own doc comment for exactly what Worker-side execution is still
  // needed (READY_FOR_LIVE_ACCEPTANCE).
  CREATE_PREVIEW: createFullPreviewRequestSchema
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
