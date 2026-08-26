import type { AeStatus, ExecuteSceneEditRequest, McpStatus, ScenePlanEntry, WorkerCapability, WorkerStatus } from "@dyo/schemas";
import { isHeartbeatStale } from "../worker/rules.js";

/**
 * The real WorkerCapability this dispatches as - already in
 * WORKER_CAPABILITIES/CLAUDE.md's fixed allowlist, never a new capability
 * name invented for this feature.
 */
const REQUIRED_WORKER_CAPABILITY: WorkerCapability = "EXECUTE_FRAME";

export interface SceneEditWorkerSnapshot {
  status: WorkerStatus;
  aeStatus: AeStatus;
  mcpStatus: McpStatus;
  capabilities: WorkerCapability[];
  currentJobId: string | null;
  lastHeartbeatAt: Date | null;
}

export interface SceneEditPlanSnapshot {
  id: string;
  revision: number;
  sourceProjectSha256: string;
  scenePlans: ScenePlanEntry[];
}

export interface ValidateSceneEditPreconditionsInput {
  request: ExecuteSceneEditRequest;
  /** The CURRENT plan for this project, freshly read - null if none exists. */
  currentPlan: SceneEditPlanSnapshot | null;
  /** The project's CURRENT manifest sha256, freshly read - null if the project doesn't exist. */
  currentProjectSourceProjectSha256: string | null;
  /** The worker's live state, freshly read - null if it has never reported in. */
  worker: SceneEditWorkerSnapshot | null;
  now: Date;
  staleAfterMs: number;
}

export type SceneEditPreconditionResult = { ok: true } | { ok: false; reason: string };

/**
 * Every condition from Phase 4/7A's own precondition list (docs/PHASES.md;
 * "Phase 4 — Dynamic Approval Table + Execution Plan" approval gate,
 * extended here for the first real single-scene edit). Any failure maps
 * to PRECONDITION_NOT_MET - never silently repaired or guessed. Pure
 * function: every input is data the caller already fetched fresh (never
 * trusts a cached/stale value itself, and never re-fetches/hides I/O).
 */
export function validateSceneEditPreconditions(input: ValidateSceneEditPreconditionsInput): SceneEditPreconditionResult {
  const { request, currentPlan, currentProjectSourceProjectSha256, worker, now, staleAfterMs } = input;

  // Redundant with the request schema's own .refine (defense in depth,
  // matching this project's established style) - the original .aep must
  // never be a mutation target, checked again here independently of
  // whatever validated the request shape.
  if (request.workingProjectPath === request.sourceProjectPath) {
    return { ok: false, reason: "workingProjectPath must differ from sourceProjectPath - refusing to target the original .aep" };
  }

  if (!currentPlan || currentPlan.id !== request.planId) {
    return { ok: false, reason: `No execution plan found matching planId "${request.planId}"` };
  }
  if (currentPlan.revision !== request.planRevision) {
    return { ok: false, reason: `Plan revision mismatch: requested ${request.planRevision}, current is ${currentPlan.revision}` };
  }
  if (currentPlan.sourceProjectSha256 !== request.sourceProjectSha256) {
    return { ok: false, reason: "Requested sourceProjectSha256 does not match the plan's own recorded sha256" };
  }
  if (currentProjectSourceProjectSha256 === null || currentProjectSourceProjectSha256 !== request.sourceProjectSha256) {
    return { ok: false, reason: "The project's current manifest sha256 no longer matches this plan/request - the source project may have changed" };
  }

  const scene = currentPlan.scenePlans.find((s) => s.id === request.scenePlanId);
  if (!scene) {
    return { ok: false, reason: `Unknown scenePlanId "${request.scenePlanId}" in this plan` };
  }
  if (scene.manifestCompositionId !== request.manifestCompositionId) {
    return { ok: false, reason: "manifestCompositionId does not match this scene's own manifestCompositionId" };
  }
  if (scene.approvalState !== "APPROVED") {
    return { ok: false, reason: `Scene "${request.scenePlanId}" is not APPROVED (current: ${scene.approvalState})` };
  }

  for (const mappingId of request.approvedMappingIds) {
    if (!scene.mappings.some((m) => m.id === mappingId)) {
      return { ok: false, reason: `approvedMappingIds references unknown mapping "${mappingId}" on this scene` };
    }
  }

  // Every operation must be derived ONLY from the already-approved plan -
  // its own value must match what is actually recorded there, never a
  // fresh/different value smuggled in at dispatch time.
  for (const operation of request.operations) {
    const mapping = scene.mappings.find((m) => m.manifestPlaceholderId === operation.manifestPlaceholderId);
    if (!mapping) {
      return {
        ok: false,
        reason: `Operation references manifestPlaceholderId "${operation.manifestPlaceholderId}" with no matching mapping on this scene`
      };
    }
    if (!request.approvedMappingIds.includes(mapping.id)) {
      return { ok: false, reason: `Mapping "${mapping.id}" for placeholder "${operation.manifestPlaceholderId}" is not in approvedMappingIds` };
    }
    if (operation.type === "SET_TEXT" && mapping.text !== operation.text) {
      return { ok: false, reason: `SET_TEXT value does not match the approved mapping's own text for "${mapping.id}"` };
    }
    if (operation.type === "MAP_FOOTAGE" && mapping.selectedAssetId === null) {
      // No real asset catalog exists yet (deliberately not invented here),
      // so assetId -> real file path cannot be cross-verified beyond this:
      // an approved mapping must at least have SOME asset recorded before
      // any MAP_FOOTAGE operation referencing it can be considered
      // derived from an actual human approval.
      return { ok: false, reason: `MAP_FOOTAGE has no approved selectedAssetId recorded on mapping "${mapping.id}"` };
    }
  }

  if (!worker) {
    return { ok: false, reason: "Worker has never reported in" };
  }
  if (worker.status !== "ONLINE" || isHeartbeatStale(worker.lastHeartbeatAt, now, staleAfterMs)) {
    return { ok: false, reason: "Worker is not currently ONLINE (no fresh heartbeat)" };
  }
  if (worker.aeStatus !== "ONLINE") {
    return { ok: false, reason: `AE is not ONLINE (reports ${worker.aeStatus})` };
  }
  if (worker.mcpStatus !== "ONLINE") {
    return { ok: false, reason: `MCP is not ONLINE (reports ${worker.mcpStatus})` };
  }
  if (!worker.capabilities.includes(REQUIRED_WORKER_CAPABILITY)) {
    return { ok: false, reason: `Worker does not report the ${REQUIRED_WORKER_CAPABILITY} capability` };
  }
  if (worker.currentJobId !== null) {
    return { ok: false, reason: "Worker already has a job in progress (currentJobId is not empty)" };
  }

  return { ok: true };
}
