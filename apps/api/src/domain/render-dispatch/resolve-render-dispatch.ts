import type { PlanStatus, RenderOutputConfig, RenderOutputVariant, RenderOutputs, WorkerCapability } from "@dyo/schemas";
import { isHeartbeatStale } from "../worker/rules.js";
import type { SceneEditWorkerSnapshot } from "../execute-scene-edit/validate-scene-edit-preconditions.js";

/**
 * The real WorkerCapability this dispatches as - already in
 * WORKER_CAPABILITIES/CLAUDE.md's fixed allowlist, never a new capability
 * name invented for this feature.
 */
const REQUIRED_WORKER_CAPABILITY: WorkerCapability = "RENDER";

export interface RenderDispatchPlanSnapshot {
  id: string;
  revision: number;
  status: PlanStatus;
  sourceProjectSha256: string;
  renderOutputs: RenderOutputs;
}

export interface ResolveRenderDispatchInput {
  variant: RenderOutputVariant;
  /** The CURRENT plan for this project, freshly read - null if none exists. */
  currentPlan: RenderDispatchPlanSnapshot | null;
  /** The project's CURRENT manifest sha256, freshly read - null if the project doesn't exist. */
  currentProjectSourceProjectSha256: string | null;
  /** The worker's live state, freshly read - null if it has never reported in. */
  worker: SceneEditWorkerSnapshot | null;
  now: Date;
  staleAfterMs: number;
}

export type ResolveRenderDispatchResult = { ok: true; config: RenderOutputConfig } | { ok: false; reason: string };

/**
 * Render-delivery phase section 9: "Dashboard/API must NOT be able to
 * dispatch arbitrary aeProjectItemIndex/compositionName/output path/
 * aerender args... Server resolves the exact persisted approved
 * configuration." The caller passes only `variant` - this resolves (and
 * validates) the REAL RenderOutputConfig already persisted via
 * set-render-output-config.ts, never accepting any addressing field from
 * a browser/API caller directly.
 *
 * Every precondition here is checked fresh against data the caller
 * already fetched (pure function, same style as
 * validateSceneEditPreconditions) - never a cached/stale value, and this
 * function itself never performs I/O.
 *
 * Known, honest limitation: this cannot verify "the working copy is
 * genuinely valid on disk" (section 9's own bullet list) - no durable
 * "last known working copy path/sha256" is tracked at the plan level
 * today (that only exists transiently inside a completed EXECUTE_FRAME
 * job's own result). The worker's own render-project-executor.ts already
 * re-verifies the working copy independently at actual render time
 * (VERIFY_WORKING_COPY stage) - this remains the real enforcement point
 * for that specific check until/unless a durable "current working copy"
 * concept is added to the plan (a larger change, deliberately not done
 * here per "do not redesign the existing render engine").
 */
export function resolveRenderDispatch(input: ResolveRenderDispatchInput): ResolveRenderDispatchResult {
  const { variant, currentPlan, currentProjectSourceProjectSha256, worker, now, staleAfterMs } = input;

  if (!currentPlan) {
    return { ok: false, reason: "No execution plan exists for this project" };
  }
  if (currentPlan.status !== "APPROVED") {
    return { ok: false, reason: `Plan is ${currentPlan.status}, not APPROVED - a render can only be dispatched from an approved plan` };
  }
  if (currentProjectSourceProjectSha256 === null || currentProjectSourceProjectSha256 !== currentPlan.sourceProjectSha256) {
    return { ok: false, reason: "The project's current manifest sha256 no longer matches this plan - the source project may have changed" };
  }

  const config = currentPlan.renderOutputs[variant];
  if (!config) {
    return { ok: false, reason: `${variant} output is not configured for this project - configure it first (see set-render-output-config.ts)` };
  }
  if (config.sourceProjectSha256 !== currentPlan.sourceProjectSha256) {
    return {
      ok: false,
      reason: `${variant} output configuration is stale (bound to a different source project revision than the plan's current one) - re-select the master composition before rendering`
    };
  }
  if (!config.renderSettingsTemplateName || !config.outputModuleTemplateName) {
    return { ok: false, reason: `${variant} output configuration is missing a required render template name` };
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

  return { ok: true, config };
}
