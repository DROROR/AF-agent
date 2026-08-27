import { z } from "zod";
import { checkHealthRequestSchema } from "./check-health.js";
import { inspectTemplateRequestSchema } from "./inspect-template.js";
import { sceneEvidenceRequestSchema } from "./scene-evidence.js";
import { inspectRenderCapabilitiesRequestSchema } from "./inspect-render-capabilities.js";
import { renderOutputVariantSchema } from "./render-project.js";
import { jobStatusSchema } from "./job.js";

/**
 * Operations a dashboard operator may dispatch via POST /api/jobs - a
 * strict subset of WORKER_CAPABILITIES (worker.ts). Adding a new
 * operation here means it has a real, reviewed, allowlisted request
 * contract below; this is never a generic "run any capability" endpoint,
 * and never accepts an arbitrary operation string - see CLAUDE.md Safety
 * Rule 2 ("never execute arbitrary AI-generated JSX... only tested,
 * versioned, allowlisted scripts/operations").
 */
export const DISPATCHABLE_OPERATIONS = [
  "INSPECT_TEMPLATE",
  "CHECK_HEALTH",
  "INSPECT_SCENE_EVIDENCE",
  "INSPECT_RENDER_CAPABILITIES",
  "EXECUTE_FRAME",
  "RENDER"
] as const;
export type DispatchableOperation = (typeof DISPATCHABLE_OPERATIONS)[number];
export const dispatchableOperationSchema = z.enum(DISPATCHABLE_OPERATIONS);

/**
 * POST /api/jobs request body - a discriminated union keyed by
 * `operation`, so each operation's payload is validated against its own
 * real, reviewed contract right here at the boundary, never
 * `z.unknown()`/`z.any()`. CHECK_HEALTH's payload is a strict empty
 * object - no command string, no path, no arbitrary field is ever
 * accepted for it. Defense in depth alongside create-job.ts's own
 * validateJobPayload() call, which validates again independently.
 *
 * EXECUTE_FRAME/RENDER deliberately carry NO `payload` field at all -
 * unlike INSPECT_TEMPLATE/CHECK_HEALTH/INSPECT_SCENE_EVIDENCE (whose
 * payloads are still accepted directly from the caller, an earlier,
 * looser precedent this activation phase does not touch), these two
 * accept ONLY a minimal, non-addressing intent (`executionSessionId` +
 * `scenePlanId` / `variant`) - the real worker-facing
 * ExecuteSceneEditRequest/RenderProjectRequest (Windows paths, composition
 * indices, JSX operations, aerender template names) is entirely
 * SERVER-RESOLVED from trusted persisted state (see
 * resolve-execute-frame-dispatch.ts/resolve-render-dispatch.ts), never
 * accepted from a browser/API caller (activation-phase sections 2-4:
 * "browser/API callers must NOT provide raw worker payloads").
 * `workerId` here is never trusted as "the worker to use" by itself for
 * these two operations - dispatch-job.ts independently verifies it equals
 * the execution session's own `assignedWorkerId` (multi-scene-accumulation
 * phase, section 8: "worker affinity" - a session's cumulative working
 * copy exists on ONE worker's local disk, so it can never be dispatched to
 * a different one). INSPECT_RENDER_CAPABILITIES needs no project/scene/
 * session context at all - its payload is a fixed empty object, identical
 * in spirit to CHECK_HEALTH's.
 */
export const dispatchJobRequestSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("INSPECT_TEMPLATE"),
    workerId: z.string().uuid(),
    payload: inspectTemplateRequestSchema
  }),
  z.object({
    operation: z.literal("CHECK_HEALTH"),
    workerId: z.string().uuid(),
    payload: checkHealthRequestSchema
  }),
  z.object({
    operation: z.literal("INSPECT_SCENE_EVIDENCE"),
    workerId: z.string().uuid(),
    /**
     * Required (unlike INSPECT_TEMPLATE/CHECK_HEALTH, which are not
     * project-bound) - a successful result can only be persisted as scene
     * evidence (see record-scene-evidence.ts) if the job that produced it is
     * attributable to a real project.
     */
    projectId: z.string().uuid(),
    payload: sceneEvidenceRequestSchema
  }),
  z.object({
    operation: z.literal("INSPECT_RENDER_CAPABILITIES"),
    workerId: z.string().uuid(),
    payload: inspectRenderCapabilitiesRequestSchema
  }),
  z
    .object({
      operation: z.literal("EXECUTE_FRAME"),
      workerId: z.string().uuid(),
      projectId: z.string().uuid(),
      executionSessionId: z.string().uuid(),
      scenePlanId: z.string().min(1)
    })
    .strict(),
  z
    .object({
      operation: z.literal("RENDER"),
      workerId: z.string().uuid(),
      projectId: z.string().uuid(),
      executionSessionId: z.string().uuid(),
      variant: renderOutputVariantSchema
    })
    .strict()
]);
export type DispatchJobRequest = z.infer<typeof dispatchJobRequestSchema>;

/** Safe DTO only - never the worker's token/tokenHash, never any other job's internal fields. */
export const dispatchJobResponseSchema = z.object({
  jobId: z.string().uuid(),
  workerId: z.string().uuid(),
  operation: dispatchableOperationSchema,
  status: jobStatusSchema,
  createdAt: z.string().datetime()
});
export type DispatchJobResponse = z.infer<typeof dispatchJobResponseSchema>;
