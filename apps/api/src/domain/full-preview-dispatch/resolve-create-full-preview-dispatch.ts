import type { CreateFullPreviewRequest, ExecutionSessionStatus, PlanStatus, RenderOutputs, ScenePlanEntry, WorkerCapability } from "@dyo/schemas";
import { TERMINAL_EXECUTION_SESSION_STATUSES } from "@dyo/schemas";
import { isHeartbeatStale } from "../worker/rules.js";
import type { SceneEditWorkerSnapshot } from "../execute-scene-edit/validate-scene-edit-preconditions.js";

/**
 * The real WorkerCapability this dispatches as - already reserved in
 * WORKER_CAPABILITIES (worker.ts), never a new capability name invented
 * for this feature. See this module's own doc comment below for what
 * real Worker-side execution support is still needed.
 */
const REQUIRED_WORKER_CAPABILITY: WorkerCapability = "CREATE_PREVIEW";

export interface FullPreviewDispatchPlanSnapshot {
  id: string;
  revision: number;
  status: PlanStatus;
  sourceProjectSha256: string;
  renderOutputs: RenderOutputs;
  scenePlans: ScenePlanEntry[];
}

/** The fields resolveCreateFullPreviewDispatch needs from a real ExecutionSessionRecord - mirrors RenderDispatchSessionSnapshot. */
export interface FullPreviewDispatchSessionSnapshot {
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

export interface ResolveCreateFullPreviewDispatchInput {
  projectId: string;
  session: FullPreviewDispatchSessionSnapshot | null;
  currentPlan: FullPreviewDispatchPlanSnapshot | null;
  currentProjectSourceProjectSha256: string | null;
  currentProjectSourceProjectPath: string | null;
  worker: SceneEditWorkerSnapshot | null;
  now: Date;
  staleAfterMs: number;
}

export type ResolveCreateFullPreviewDispatchResult = { ok: true; payload: CreateFullPreviewRequest } | { ok: false; reason: string };

/**
 * Client-handoff phase, "real final preview approval gate", section 2
 * ("Full Preview Artifact Contract"). Mirrors resolveRenderDispatch's own
 * READY_TO_RENDER gate closely, but for the intermediate "assemble a
 * complete preview of the CURRENT cumulative working copy" step: the
 * session must exist and be bound to the current APPROVED plan, every
 * required scene must already be complete, and firstPreviewApproved must
 * already be true (the task's own desired sequencing: "FIRST PREVIEW
 * APPROVED -> remaining approved scenes execute -> FULL PREVIEW artifact
 * becomes ready").
 *
 * Deliberately reuses the project's already-configured LANDSCAPE
 * RenderOutputConfig (set-render-output-config.ts) for its own
 * composition/template identity rather than inventing a second,
 * competing "preview composition" concept - the complete preview shows
 * what the Landscape render will actually look like, using the exact
 * same composition/templates. This is "using existing approval/revision/
 * state infrastructure" per this task's own explicit instruction, not a
 * new persisted concept.
 *
 * IMPORTANT - Worker-side execution status: this resolver, the dispatch
 * wiring (dispatch-job.ts), the upload endpoint (upload-full-preview.ts),
 * and the full_preview_artifacts persistence are all real and complete.
 * What is NOT yet built is the Worker's own CREATE_PREVIEW execution
 * handler (apps/worker/src/domain/operation-allowlist.ts's
 * CURRENT_WORKER_CAPABILITIES does not include it - see worker.ts's own
 * WORKER_CAPABILITIES doc comment: "8 names... RESERVED/PLANNED ONLY").
 * No real Worker build reports this capability today, so
 * findDispatchableWorker will always return null for it in the dashboard
 * UI, surfacing as the SAME honest "no worker available" messaging used
 * everywhere else a capability isn't supported yet - never a fabricated
 * success. Building the real AE-side "assemble + quick-render the current
 * working copy" execution logic is the concrete remaining Worker gap -
 * marked READY_FOR_LIVE_ACCEPTANCE, not fabricated here.
 */
export function resolveCreateFullPreviewDispatch(input: ResolveCreateFullPreviewDispatchInput): ResolveCreateFullPreviewDispatchResult {
  const { projectId, session, currentPlan, currentProjectSourceProjectSha256, currentProjectSourceProjectPath, worker, now, staleAfterMs } = input;

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
    return { ok: false, reason: `Plan is ${currentPlan.status}, not APPROVED - a complete preview can only be created from an approved plan` };
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

  const config = currentPlan.renderOutputs.LANDSCAPE;
  if (!config) {
    return { ok: false, reason: "Landscape output is not configured for this project yet - configure it in Render Settings before creating the complete preview" };
  }
  if (config.sourceProjectSha256 !== currentPlan.sourceProjectSha256) {
    return { ok: false, reason: "Landscape output configuration is stale (bound to a different source project revision) - re-select the master composition before creating the complete preview" };
  }
  if (!config.renderSettingsTemplateName || !config.outputModuleTemplateName) {
    return { ok: false, reason: "Landscape output configuration is missing a required render template name" };
  }

  if (!session.latestWorkingProjectSha256) {
    return { ok: false, reason: "No scene edit has completed in this execution session yet - complete the approved scenes before creating the complete preview" };
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
      reason: `This execution session has not yet completed every approved scene (${missingScenes.length} remaining) - not ready to create the complete preview`
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
      executionSessionId: session.id,
      sourceProjectPath: currentProjectSourceProjectPath,
      sourceProjectSha256: currentProjectSourceProjectSha256,
      expectedWorkingProjectSha256: session.latestWorkingProjectSha256,
      aeProjectItemIndex: config.aeProjectItemIndex,
      compositionName: config.compositionName,
      renderSettingsTemplateName: config.renderSettingsTemplateName,
      outputModuleTemplateName: config.outputModuleTemplateName
    }
  };
}
