import type { HeartbeatRequest } from "@dyo/schemas";
import { CURRENT_WORKER_CAPABILITIES } from "../domain/operation-allowlist.js";
import type { HealthSnapshot } from "../health/health-snapshot.js";

/** Fixed for Phase 2 - see docs/engineering/ARCHITECTURE_RULES.md ("initial maxConcurrency = 1"). */
const PHASE_2_MAX_CONCURRENCY = 1;

/**
 * Maps the full local health picture onto the (already-versioned, shared)
 * heartbeat wire schema. No job execution exists yet, so currentJobId is
 * always null - see docs/engineering/CODE_STANDARDS.md on not duplicating
 * business rules: this is the only place that builds this payload shape.
 */
export function buildHeartbeatPayload(health: HealthSnapshot): HeartbeatRequest {
  return {
    aeStatus: health.aeStatus,
    mcpStatus: health.mcpStatus,
    aeVersion: health.aeVersion,
    capabilities: [...CURRENT_WORKER_CAPABILITIES],
    maxConcurrency: PHASE_2_MAX_CONCURRENCY,
    currentJobId: null
  };
}
