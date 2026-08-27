import type { PlanStatus, RenderOutputVariant, RenderOutputs, RenderProjectRequest, WorkerCapability } from "@dyo/schemas";
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
  /** The most recently successfully-completed EXECUTE_FRAME job's own working-copy identity - see record-execute-frame-result.ts/schema.ts's own doc comment. Null until at least one EXECUTE_FRAME job has ever succeeded for this plan. */
  workingProjectPath: string | null;
  workingProjectSha256: string | null;
}

export interface ResolveRenderDispatchInput {
  projectId: string;
  variant: RenderOutputVariant;
  /** The CURRENT plan for this project, freshly read - null if none exists. */
  currentPlan: RenderDispatchPlanSnapshot | null;
  /** The project's CURRENT manifest sha256, freshly read - null if the project doesn't exist. */
  currentProjectSourceProjectSha256: string | null;
  /** The project's CURRENT manifest sourceProject.path, freshly read - null if the project doesn't exist. */
  currentProjectSourceProjectPath: string | null;
  /** The worker's live state, freshly read - null if it has never reported in. */
  worker: SceneEditWorkerSnapshot | null;
  now: Date;
  staleAfterMs: number;
}

export type ResolveRenderDispatchResult =
  | { ok: true; payload: Omit<RenderProjectRequest, "checkpoint"> }
  | { ok: false; reason: string };

/**
 * Render-delivery phase section 9 / activation-phase section 4: "Browser
 * only requests LANDSCAPE or REELS... Server derives... No arbitrary
 * render payload passthrough." The caller passes only `projectId` +
 * `variant` - this resolves (and validates) the REAL, persisted
 * RenderOutputConfig (set-render-output-config.ts) AND the plan's own
 * durably-tracked working-copy identity (record-execute-frame-result.ts -
 * the most recently succeeded EXECUTE_FRAME job's own reported path/
 * sha256, never re-derived or guessed here), building the complete
 * RenderProjectRequest a worker actually needs - never accepting any
 * addressing/path field from a browser/API caller directly.
 *
 * Every precondition here is checked fresh against data the caller
 * already fetched (pure function, same style as
 * validateSceneEditPreconditions/resolveExecuteFrameDispatch) - never a
 * cached/stale value, and this function itself never performs I/O.
 *
 * The working copy's own CONTENT is still independently re-verified by
 * the worker itself at actual render time (render-project-executor.ts's
 * VERIFY_WORKING_COPY stage, re-hashing the real file on disk) - this
 * function only proves a working copy is durably ON RECORD at all before
 * ever dispatching, never that the file still exists/matches (that
 * remains the worker's own real enforcement point, by design).
 */
export function resolveRenderDispatch(input: ResolveRenderDispatchInput): ResolveRenderDispatchResult {
  const { projectId, variant, currentPlan, currentProjectSourceProjectSha256, currentProjectSourceProjectPath, worker, now, staleAfterMs } = input;

  if (!currentPlan) {
    return { ok: false, reason: "No execution plan exists for this project" };
  }
  if (currentPlan.status !== "APPROVED") {
    return { ok: false, reason: `Plan is ${currentPlan.status}, not APPROVED - a render can only be dispatched from an approved plan` };
  }
  if (
    currentProjectSourceProjectSha256 === null ||
    currentProjectSourceProjectPath === null ||
    currentProjectSourceProjectSha256 !== currentPlan.sourceProjectSha256
  ) {
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

  if (!currentPlan.workingProjectPath || !currentPlan.workingProjectSha256) {
    return {
      ok: false,
      reason: "No working copy has been produced for this plan yet - dispatch EXECUTE_FRAME for at least one approved scene before rendering"
    };
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

  return {
    ok: true,
    payload: {
      projectId,
      planId: currentPlan.id,
      planRevision: currentPlan.revision,
      variant,
      sourceProjectPath: currentProjectSourceProjectPath,
      sourceProjectSha256: currentPlan.sourceProjectSha256,
      workingProjectPath: currentPlan.workingProjectPath,
      workingProjectSha256: currentPlan.workingProjectSha256,
      aeProjectItemIndex: config.aeProjectItemIndex,
      compositionName: config.compositionName,
      renderSettingsTemplateName: config.renderSettingsTemplateName,
      outputModuleTemplateName: config.outputModuleTemplateName
    }
  };
}
