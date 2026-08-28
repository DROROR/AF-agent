import type { ExecuteSceneEditRequest, ExecutionSessionStatus, PlanStatus, SceneEditOperationIntent, ScenePlanEntry, TemplateManifest, WorkerCapability } from "@dyo/schemas";
import { TERMINAL_EXECUTION_SESSION_STATUSES } from "@dyo/schemas";
import { isHeartbeatStale } from "../worker/rules.js";
import type { SceneEditWorkerSnapshot } from "../execute-scene-edit/validate-scene-edit-preconditions.js";
import type { AssetRecord } from "../asset/types.js";

/**
 * The real WorkerCapability this dispatches as - already in
 * WORKER_CAPABILITIES/CLAUDE.md's fixed allowlist, never a new capability
 * name invented for this feature.
 */
const REQUIRED_WORKER_CAPABILITY: WorkerCapability = "EXECUTE_FRAME";

/** Manifest classification values MAP_FOOTAGE can resolve today - every one names an asset-bearing placeholder type. */
const ASSET_CLASSIFICATIONS = ["image", "video", "logo", "phone_screen"] as const;

export interface ExecuteFrameDispatchPlanSnapshot {
  id: string;
  revision: number;
  status: PlanStatus;
  sourceProjectSha256: string;
  scenePlans: ScenePlanEntry[];
}

/** The fields resolveExecuteFrameDispatch/resolveRenderDispatch actually need from a real ExecutionSessionRecord - a narrow snapshot, same style as SceneEditWorkerSnapshot/ExecuteFrameDispatchPlanSnapshot. */
export interface ExecuteFrameDispatchSessionSnapshot {
  id: string;
  projectId: string;
  planRevision: number;
  sourceProjectSha256: string;
  assignedWorkerId: string;
  status: ExecutionSessionStatus;
  latestWorkingProjectSha256: string | null;
  completedScenePlanIds: string[];
}

export interface ResolveExecuteFrameDispatchInput {
  projectId: string;
  scenePlanId: string;
  /** The session this scene edit is being dispatched into - resolved by the caller from `executionSessionId`, null if it doesn't exist. */
  session: ExecuteFrameDispatchSessionSnapshot | null;
  /** The CURRENT plan for this project, freshly read - null if none exists. */
  currentPlan: ExecuteFrameDispatchPlanSnapshot | null;
  /** The project's CURRENT manifest, freshly read - null if the project doesn't exist. Used both for its own sha256 and to resolve composition/placeholder identity. */
  currentProjectManifest: TemplateManifest | null;
  /** Every real asset currently in this project's Asset Catalog, freshly read - never fetched by this pure function itself. */
  projectAssets: AssetRecord[];
  /** The worker actually being dispatched to, freshly read - null if it has never reported in. */
  worker: SceneEditWorkerSnapshot | null;
  now: Date;
  staleAfterMs: number;
}

export type ResolveExecuteFrameDispatchResult =
  | { ok: true; payload: Omit<ExecuteSceneEditRequest, "checkpoint"> }
  | { ok: false; reason: string };

/**
 * Multi-scene-accumulation phase, section 9: "Safe browser-facing intent
 * remains project/scene/approved action... Server resolves current
 * execution session, assigned Worker, plan revision, source SHA, latest
 * working-copy SHA, scene operations." The caller passes only `projectId` +
 * `scenePlanId` + the session identified by the browser's own
 * `executionSessionId` - every other field of the real
 * ExecuteSceneEditRequest is resolved here from data the caller already
 * fetched fresh (pure function, same style as resolveRenderDispatch/
 * validateSceneEditPreconditions - never I/O, never a cached/stale value).
 *
 * Session-aware preconditions (new in this phase, on top of the original
 * plan/scene/worker checks below):
 *   - the session must exist and belong to this project,
 *   - the session must not be terminal (COMPLETED/FAILED) - section 11's
 *     "start a new execution session" is the only way forward for those,
 *   - the session's own bound planRevision/sourceProjectSha256 must still
 *     match the CURRENT plan (section 11: a plan revision change never
 *     silently applies to an existing session),
 *   - the worker actually being dispatched to must be the session's own
 *     assignedWorkerId (section 8: worker affinity - the cumulative
 *     working copy exists on ONE worker's local disk only),
 *   - this exact scenePlanId must not already be in the session's own
 *     completedScenePlanIds (never a double-edit within one session -
 *     section 16's own "multi-scene edits accumulate" proof).
 *
 * Operations are derived directly from the scene's own approved mappings -
 * a SET_TEXT operation's `text` is always exactly `mapping.text`, a
 * MAP_FOOTAGE operation's asset identity is always exactly the mapping's
 * own `selectedAssetId` cross-referenced against the real Asset Catalog -
 * never a value invented or accepted from the caller. `approvedMappingIds`
 * is built from the SAME mappings the operations themselves came from, so
 * it can never disagree with them.
 *
 * SET_BRAND_COLOR/SET_LAYER_VISIBILITY/SET_TIME_REMAP_FREEZE/SET_DURATION
 * (operation-resolution phase, section A) are now fully resolvable:
 *   - SET_BRAND_COLOR fires only for a mapping classified "color", from
 *     its own explicit `colorHex` (already canonical #RRGGBB - normalized
 *     at edit time, never here) - a "color" mapping with no colorHex set
 *     fails dispatch closed rather than fabricating a value.
 *   - SET_LAYER_VISIBILITY/SET_TIME_REMAP_FREEZE/SET_DURATION are
 *     independent, OPTIONAL per-mapping overrides (`layerVisible`/
 *     `freezeAtSeconds`/`layerDurationSeconds`) - orthogonal to the
 *     mapping's own classification (a text/asset mapping can also carry
 *     one of these), only ever emitted when the operator explicitly set
 *     it, never required for a scene to be otherwise dispatchable.
 *
 * A mapping with `manifestPlaceholderId: null` (human-added, no manifest
 * layer target) is silently excluded from `operations` entirely - it
 * cannot be translated into any fixed operation (no layerIndex to
 * address), and is not itself evidence of anything unresolved.
 */
export function resolveExecuteFrameDispatch(input: ResolveExecuteFrameDispatchInput): ResolveExecuteFrameDispatchResult {
  const { projectId, scenePlanId, session, currentPlan, currentProjectManifest, projectAssets, worker, now, staleAfterMs } = input;

  if (!session) {
    return { ok: false, reason: "No execution session was found for the requested executionSessionId - start one first" };
  }
  if (session.projectId !== projectId) {
    return { ok: false, reason: "The execution session does not belong to this project" };
  }
  if (TERMINAL_EXECUTION_SESSION_STATUSES.includes(session.status)) {
    return { ok: false, reason: `Execution session is ${session.status} - start a new execution session to continue` };
  }
  if (session.completedScenePlanIds.includes(scenePlanId)) {
    return { ok: false, reason: `Scene "${scenePlanId}" has already been edited in this execution session` };
  }

  if (!currentPlan) {
    return { ok: false, reason: "No execution plan exists for this project" };
  }
  if (currentPlan.status !== "APPROVED") {
    return { ok: false, reason: `Plan is ${currentPlan.status}, not APPROVED - EXECUTE_FRAME can only be dispatched from an approved plan` };
  }
  if (session.planRevision !== currentPlan.revision || session.sourceProjectSha256 !== currentPlan.sourceProjectSha256) {
    return {
      ok: false,
      reason: `Execution session is bound to plan revision ${session.planRevision}, but the current plan is revision ${currentPlan.revision} - the plan changed after this session began; start a new execution session`
    };
  }
  if (!currentProjectManifest || currentProjectManifest.sourceProject.sha256 !== currentPlan.sourceProjectSha256) {
    return { ok: false, reason: "The project's current manifest sha256 no longer matches this plan - the source project may have changed" };
  }

  const scene = currentPlan.scenePlans.find((s) => s.id === scenePlanId);
  if (!scene) {
    return { ok: false, reason: `Unknown scenePlanId "${scenePlanId}" in this plan` };
  }
  if (!scene.use) {
    return { ok: false, reason: `Scene "${scenePlanId}" is excluded from the final output (use=false) - cannot be dispatched` };
  }
  if (scene.approvalState !== "APPROVED") {
    return { ok: false, reason: `Scene "${scenePlanId}" is not APPROVED (current: ${scene.approvalState})` };
  }
  if (scene.unresolvedReasons.length > 0) {
    return { ok: false, reason: `Scene "${scenePlanId}" has unresolved reasons: ${scene.unresolvedReasons.join("; ")}` };
  }

  const composition = currentProjectManifest.compositions.find((c) => c.compositionId === scene.manifestCompositionId);
  if (!composition) {
    return { ok: false, reason: `manifestCompositionId "${scene.manifestCompositionId}" does not match any composition in the current manifest` };
  }
  const manifestScene = currentProjectManifest.scenes.find((s) => s.compositionId === scene.manifestCompositionId);

  const assetsById = new Map(projectAssets.map((asset) => [asset.id, asset]));
  const operations: SceneEditOperationIntent[] = [];
  const approvedMappingIds: string[] = [];

  for (const mapping of scene.mappings) {
    if (mapping.manifestPlaceholderId === null) {
      continue;
    }
    const placeholder = manifestScene?.placeholders.find((p) => p.placeholderId === mapping.manifestPlaceholderId);
    if (!placeholder) {
      return {
        ok: false,
        reason: `Mapping "${mapping.id}" references manifestPlaceholderId "${mapping.manifestPlaceholderId}" which no longer exists in the current manifest`
      };
    }

    // Defensive against a plan revision persisted before these four fields
    // existed (a real .aep working DB row's scenePlans jsonb blob predating
    // this schema addition would have these keys entirely absent, not
    // merely null) - `??` coalesces that "never set" case the exact same
    // way an explicit `null` already means "no override", so an old row
    // can never be misread as an operator-set SET_LAYER_VISIBILITY(visible:
    // undefined) etc.
    const colorHex = mapping.colorHex ?? null;
    const layerVisible = mapping.layerVisible ?? null;
    const freezeAtSeconds = mapping.freezeAtSeconds ?? null;
    const layerDurationSeconds = mapping.layerDurationSeconds ?? null;

    const classification = mapping.placeholderClassification.value;
    if (classification === "text") {
      if (mapping.text === null) {
        return { ok: false, reason: `Mapping "${mapping.id}" is classified as text but has no text set` };
      }
      operations.push({ type: "SET_TEXT", manifestPlaceholderId: mapping.manifestPlaceholderId, layerIndex: placeholder.layerIndex, text: mapping.text });
      approvedMappingIds.push(mapping.id);
    } else if ((ASSET_CLASSIFICATIONS as readonly string[]).includes(classification ?? "")) {
      if (mapping.selectedAssetId === null) {
        return { ok: false, reason: `Mapping "${mapping.id}" is classified as ${classification} but has no selectedAssetId set` };
      }
      const asset = assetsById.get(mapping.selectedAssetId);
      if (!asset) {
        return { ok: false, reason: `Mapping "${mapping.id}"'s selected asset "${mapping.selectedAssetId}" no longer exists in this project's Asset Catalog` };
      }
      operations.push({
        type: "MAP_FOOTAGE",
        manifestPlaceholderId: mapping.manifestPlaceholderId,
        layerIndex: placeholder.layerIndex,
        assetId: asset.id,
        expectedSha256: asset.sha256,
        mimeType: asset.mimeType
      });
      approvedMappingIds.push(mapping.id);
    } else if (classification === "color") {
      // SET_BRAND_COLOR - only supported target: a placeholder explicitly
      // classified "color" (operation-resolution phase, section A). The
      // canonical #RRGGBB value itself was already normalized at edit time
      // (apply-execution-plan-edit.ts) - this never fabricates a default
      // for an unset color.
      if (colorHex === null) {
        return { ok: false, reason: `Mapping "${mapping.id}" is classified as "color" but has no colorHex set` };
      }
      operations.push({
        type: "SET_BRAND_COLOR",
        manifestPlaceholderId: mapping.manifestPlaceholderId,
        layerIndex: placeholder.layerIndex,
        colorHex
      });
      approvedMappingIds.push(mapping.id);
    } else if (layerVisible === null && freezeAtSeconds === null && layerDurationSeconds === null) {
      // No resolvable primary classification AND no independent override
      // either - genuinely nothing to derive an operation from.
      return {
        ok: false,
        reason: `Mapping "${mapping.id}" has no resolved classification (${String(classification)}) - cannot derive an operation from it`
      };
    }
    // else: classification isn't itself resolvable (or inapplicable), but
    // at least one independent override below still applies to this same
    // layer - never an error by itself (section A: these three are
    // orthogonal to classification, not gated behind it).

    // SET_LAYER_VISIBILITY / SET_TIME_REMAP_FREEZE / SET_DURATION are
    // independent, OPTIONAL per-mapping operator overrides (section A) -
    // orthogonal to the mapping's own classification above (a text or
    // asset mapping can ALSO carry a visibility/freeze/duration override
    // on the same layer). Each is only ever emitted when the operator
    // explicitly set it (apply-execution-plan-edit.ts's SET_*/CLEAR_*
    // operations) - never a fabricated default, and never required for a
    // scene to be dispatchable by themselves.
    if (layerVisible !== null) {
      operations.push({
        type: "SET_LAYER_VISIBILITY",
        manifestPlaceholderId: mapping.manifestPlaceholderId,
        layerIndex: placeholder.layerIndex,
        visible: layerVisible
      });
      if (!approvedMappingIds.includes(mapping.id)) approvedMappingIds.push(mapping.id);
    }
    if (freezeAtSeconds !== null) {
      operations.push({
        type: "SET_TIME_REMAP_FREEZE",
        manifestPlaceholderId: mapping.manifestPlaceholderId,
        layerIndex: placeholder.layerIndex,
        freezeAtSeconds
      });
      if (!approvedMappingIds.includes(mapping.id)) approvedMappingIds.push(mapping.id);
    }
    if (layerDurationSeconds !== null) {
      operations.push({
        type: "SET_DURATION",
        manifestPlaceholderId: mapping.manifestPlaceholderId,
        layerIndex: placeholder.layerIndex,
        durationSeconds: layerDurationSeconds
      });
      if (!approvedMappingIds.includes(mapping.id)) approvedMappingIds.push(mapping.id);
    }
  }

  if (operations.length === 0) {
    return { ok: false, reason: `Scene "${scenePlanId}" has no resolvable operations (no mapping with a manifest-linked placeholder and a set value)` };
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
      sourceProjectSha256: currentPlan.sourceProjectSha256,
      sourceProjectPath: currentProjectManifest.sourceProject.path,
      executionSessionId: session.id,
      expectedWorkingProjectSha256: session.latestWorkingProjectSha256,
      scenePlanId,
      manifestCompositionId: scene.manifestCompositionId,
      aeProjectItemIndex: composition.aeProjectItemIndex,
      compositionName: composition.name,
      approvedMappingIds,
      operations
    }
  };
}
