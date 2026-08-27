import type { ExecutionSessionStatus, PlanStatus, RenderOutputVariant, RenderOutputs, RenderProjectRequest, ScenePlanEntry, WorkerCapability } from "@dyo/schemas";
import { TERMINAL_EXECUTION_SESSION_STATUSES } from "@dyo/schemas";
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
  scenePlans: ScenePlanEntry[];
}

/** The fields resolveRenderDispatch actually needs from a real ExecutionSessionRecord - mirrors ExecuteFrameDispatchSessionSnapshot. */
export interface RenderDispatchSessionSnapshot {
  id: string;
  projectId: string;
  planRevision: number;
  sourceProjectSha256: string;
  assignedWorkerId: string;
  status: ExecutionSessionStatus;
  latestWorkingProjectSha256: string | null;
  completedScenePlanIds: string[];
  firstPreviewApproved: boolean;
}

export interface ResolveRenderDispatchInput {
  projectId: string;
  variant: RenderOutputVariant;
  /** The session this render is being dispatched from - resolved by the caller from `executionSessionId`, null if it doesn't exist. */
  session: RenderDispatchSessionSnapshot | null;
  /** The CURRENT plan for this project, freshly read - null if none exists. */
  currentPlan: RenderDispatchPlanSnapshot | null;
  /** The project's CURRENT manifest sha256, freshly read - null if the project doesn't exist. */
  currentProjectSourceProjectSha256: string | null;
  /** The project's CURRENT manifest sourceProject.path, freshly read - null if the project doesn't exist. */
  currentProjectSourceProjectPath: string | null;
  /** The worker actually being dispatched to, freshly read - null if it has never reported in. */
  worker: SceneEditWorkerSnapshot | null;
  now: Date;
  staleAfterMs: number;
}

export type ResolveRenderDispatchResult =
  | { ok: true; payload: Omit<RenderProjectRequest, "checkpoint"> }
  | { ok: false; reason: string };

/**
 * Multi-scene-accumulation phase, section 12: "RENDER must no longer
 * create/find an independent working copy... LANDSCAPE and REELS render
 * requests reference executionSessionId... Worker derives the same
 * execution-session AEP path and verifies SHA before aerender." The caller
 * passes only `projectId` + `variant` + the session identified by the
 * browser's own `executionSessionId` - this resolves (and validates) the
 * REAL, persisted RenderOutputConfig (set-render-output-config.ts) AND the
 * session's own READY_TO_RENDER gate (section 13), building the complete
 * RenderProjectRequest a worker actually needs - never accepting any
 * addressing/path field from a browser/API caller directly.
 *
 * READY_TO_RENDER gate (section 13) - all of the following must hold:
 *   - the session exists, belongs to this project, is not terminal,
 *   - the session's own bound planRevision/sourceProjectSha256 still match
 *     the CURRENT plan (section 11 - same rule as EXECUTE_FRAME),
 *   - at least one scene edit has ever succeeded for this session
 *     (latestWorkingProjectSha256 is non-null - there is a cumulative
 *     working copy to render at all),
 *   - firstPreviewApproved is true (section 10 - the human preview gate),
 *   - every plan scene that is use=true/APPROVED/no-unresolved-reasons has
 *     completed in this session (completedScenePlanIds covers them all -
 *     never a partial render from an in-progress session).
 *
 * Every precondition here is checked fresh against data the caller
 * already fetched (pure function, same style as
 * resolveExecuteFrameDispatch/validateSceneEditPreconditions) - never a
 * cached/stale value, and this function itself never performs I/O.
 *
 * The working copy's own CONTENT is still independently re-verified by
 * the worker itself at actual render time (render-project-executor.ts's
 * VERIFY_WORKING_COPY stage, re-hashing the real file it derives from
 * `executionSessionId`) - this function only proves a working copy is
 * durably ON RECORD and complete before ever dispatching, never that the
 * file still exists/matches (that remains the worker's own real
 * enforcement point, by design).
 */
export function resolveRenderDispatch(input: ResolveRenderDispatchInput): ResolveRenderDispatchResult {
  const { projectId, variant, session, currentPlan, currentProjectSourceProjectSha256, currentProjectSourceProjectPath, worker, now, staleAfterMs } = input;

  if (!session) {
    return { ok: false, reason: "No execution session was found for the requested executionSessionId" };
  }
  if (session.projectId !== projectId) {
    return { ok: false, reason: "The execution session does not belong to this project" };
  }
  if (TERMINAL_EXECUTION_SESSION_STATUSES.includes(session.status)) {
    return { ok: false, reason: `Execution session is ${session.status} - start a new execution session to continue` };
  }

  if (!currentPlan) {
    return { ok: false, reason: "No execution plan exists for this project" };
  }
  if (currentPlan.status !== "APPROVED") {
    return { ok: false, reason: `Plan is ${currentPlan.status}, not APPROVED - a render can only be dispatched from an approved plan` };
  }
  if (session.planRevision !== currentPlan.revision || session.sourceProjectSha256 !== currentPlan.sourceProjectSha256) {
    return {
      ok: false,
      reason: `Execution session is bound to plan revision ${session.planRevision}, but the current plan is revision ${currentPlan.revision} - the plan changed after this session began; start a new execution session`
    };
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

  if (!session.latestWorkingProjectSha256) {
    return {
      ok: false,
      reason: "No scene edit has completed in this execution session yet - dispatch EXECUTE_FRAME for at least one approved scene before rendering"
    };
  }
  if (!session.firstPreviewApproved) {
    return { ok: false, reason: "The first-frame preview for this execution session has not been approved yet" };
  }
  const requiredScenePlanIds = currentPlan.scenePlans
    .filter((s) => s.use && s.approvalState === "APPROVED" && s.unresolvedReasons.length === 0)
    .map((s) => s.id);
  const completed = new Set(session.completedScenePlanIds);
  const missingScenes = requiredScenePlanIds.filter((id) => !completed.has(id));
  if (missingScenes.length > 0) {
    return {
      ok: false,
      reason: `This execution session has not yet completed every approved scene (${missingScenes.length} remaining) - not ready to render`
    };
  }

  if (!worker) {
    return { ok: false, reason: "Worker has never reported in" };
  }
  if (worker.id !== session.assignedWorkerId) {
    return { ok: false, reason: "This execution session is pinned to a different worker - its cumulative working copy exists only on that worker's local disk" };
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
      executionSessionId: session.id,
      expectedWorkingProjectSha256: session.latestWorkingProjectSha256,
      aeProjectItemIndex: config.aeProjectItemIndex,
      compositionName: config.compositionName,
      renderSettingsTemplateName: config.renderSettingsTemplateName,
      outputModuleTemplateName: config.outputModuleTemplateName
    }
  };
}
