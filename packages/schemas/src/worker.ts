import { z } from "zod";

/**
 * Overall worker connectivity. Derived from heartbeat freshness, not set
 * directly by the worker - see docs/engineering/ARCHITECTURE_RULES.md
 * ("job state machine transitions must be explicit and validated").
 */
export const WORKER_STATUSES = ["ONLINE", "OFFLINE"] as const;
export type WorkerStatus = (typeof WORKER_STATUSES)[number];
export const workerStatusSchema = z.enum(WORKER_STATUSES);

/** Reported by the worker itself on every heartbeat. */
export const AE_STATUSES = ["ONLINE", "OFFLINE", "UNKNOWN"] as const;
export type AeStatus = (typeof AE_STATUSES)[number];
export const aeStatusSchema = z.enum(AE_STATUSES);

export const MCP_STATUSES = ["ONLINE", "OFFLINE", "UNKNOWN"] as const;
export type McpStatus = (typeof MCP_STATUSES)[number];
export const mcpStatusSchema = z.enum(MCP_STATUSES);

/**
 * Allowlisted operations a worker may claim - see docs/MASTER_PLAN.md
 * section 6. This is the single source of truth; nothing else should
 * redeclare this list.
 */
export const WORKER_CAPABILITIES = [
  "CHECK_HEALTH",
  "INSPECT_TEMPLATE",
  "INSPECT_SCENE_EVIDENCE",
  "VALIDATE_PLAN",
  "PREPARE_PROJECT",
  "EXECUTE_FRAME",
  "APPLY_BRANDING",
  "CREATE_PREVIEW",
  "CREATE_HORIZONTAL",
  "CREATE_REELS",
  "PREPARE_RENDER",
  "RENDER",
  /** Read-only, preparing for final Windows Worker verification - see inspect-render-capabilities.ts's own doc comment. Never mutates, never saves, never contacts the client. */
  "INSPECT_RENDER_CAPABILITIES",
  "RESUME_JOB"
] as const;
export type WorkerCapability = (typeof WORKER_CAPABILITIES)[number];
export const workerCapabilitySchema = z.enum(WORKER_CAPABILITIES);

export const registerWorkerRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  maxConcurrency: z.number().int().positive().max(64).default(1),
  capabilities: z.array(workerCapabilitySchema).default([])
});
export type RegisterWorkerRequest = z.infer<typeof registerWorkerRequestSchema>;

export const registerWorkerResponseSchema = z.object({
  workerId: z.string().uuid(),
  workerToken: z.string().min(1)
});
export type RegisterWorkerResponse = z.infer<typeof registerWorkerResponseSchema>;

export const heartbeatRequestSchema = z.object({
  aeStatus: aeStatusSchema,
  mcpStatus: mcpStatusSchema,
  aeVersion: z.string().trim().min(1).max(50).nullable().default(null),
  capabilities: z.array(workerCapabilitySchema).optional(),
  maxConcurrency: z.number().int().positive().max(64).optional(),
  currentJobId: z.string().uuid().nullable().default(null)
});
export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;

export const workerDtoSchema = z.object({
  workerId: z.string().uuid(),
  name: z.string(),
  status: workerStatusSchema,
  lastHeartbeatAt: z.string().datetime().nullable(),
  aeStatus: aeStatusSchema,
  mcpStatus: mcpStatusSchema,
  aeVersion: z.string().nullable(),
  capabilities: z.array(workerCapabilitySchema),
  maxConcurrency: z.number().int().positive(),
  currentJobId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type WorkerDto = z.infer<typeof workerDtoSchema>;

export const listWorkersResponseSchema = z.object({
  workers: z.array(workerDtoSchema)
});
export type ListWorkersResponse = z.infer<typeof listWorkersResponseSchema>;
