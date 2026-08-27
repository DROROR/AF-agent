import type { ExecuteSceneEditRequest, PlanStatus, SceneEditOperationIntent, ScenePlanEntry, TemplateManifest, WorkerCapability } from "@dyo/schemas";
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

export interface ResolveExecuteFrameDispatchInput {
  projectId: string;
  scenePlanId: string;
  /** The CURRENT plan for this project, freshly read - null if none exists. */
  currentPlan: ExecuteFrameDispatchPlanSnapshot | null;
  /** The project's CURRENT manifest, freshly read - null if the project doesn't exist. Used both for its own sha256 and to resolve composition/placeholder identity. */
  currentProjectManifest: TemplateManifest | null;
  /** Every real asset currently in this project's Asset Catalog, freshly read - never fetched by this pure function itself. */
  projectAssets: AssetRecord[];
  /** The worker's live state, freshly read - null if it has never reported in. */
  worker: SceneEditWorkerSnapshot | null;
  now: Date;
  staleAfterMs: number;
}

export type ResolveExecuteFrameDispatchResult =
  | { ok: true; payload: Omit<ExecuteSceneEditRequest, "checkpoint"> }
  | { ok: false; reason: string };

/**
 * Activation-phase section 3: "Browser/API should identify approved
 * project/scene intent only. Server derives the Worker payload from
 * trusted persisted state." The caller passes only `projectId` +
 * `scenePlanId` - every other field of the real ExecuteSceneEditRequest is
 * resolved here from data the caller already fetched fresh (pure
 * function, same style as resolveRenderDispatch/
 * validateSceneEditPreconditions - never I/O, never a cached/stale value).
 *
 * Operations are derived directly from the scene's own approved mappings -
 * a SET_TEXT operation's `text` is always exactly `mapping.text`, a
 * MAP_FOOTAGE operation's asset identity is always exactly the mapping's
 * own `selectedAssetId` cross-referenced against the real Asset Catalog -
 * never a value invented or accepted from the caller. `approvedMappingIds`
 * is built from the SAME mappings the operations themselves came from, so
 * it can never disagree with them.
 *
 * Honest, deliberate scope limits (never silently worked around):
 *   - SET_BRAND_COLOR/SET_LAYER_VISIBILITY/SET_TIME_REMAP_FREEZE/
 *     SET_DURATION have no resolvable data source in the current mapping
 *     model (no per-mapping colorHex/visibility/freeze/duration field
 *     exists yet) - a mapping classified "color" fails dispatch outright
 *     rather than fabricating a value never actually approved.
 *   - A mapping with `manifestPlaceholderId: null` (human-added, no
 *     manifest layer target) is silently excluded from `operations` - it
 *     cannot be translated into any fixed operation (no layerIndex to
 *     address), and is not itself evidence of anything unresolved.
 */
export function resolveExecuteFrameDispatch(input: ResolveExecuteFrameDispatchInput): ResolveExecuteFrameDispatchResult {
  const { projectId, scenePlanId, currentPlan, currentProjectManifest, projectAssets, worker, now, staleAfterMs } = input;

  if (!currentPlan) {
    return { ok: false, reason: "No execution plan exists for this project" };
  }
  if (currentPlan.status !== "APPROVED") {
    return { ok: false, reason: `Plan is ${currentPlan.status}, not APPROVED - EXECUTE_FRAME can only be dispatched from an approved plan` };
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
    } else {
      return {
        ok: false,
        reason:
          classification === "color"
            ? `Mapping "${mapping.id}" is classified as "color" - SET_BRAND_COLOR has no resolvable data source yet, cannot be dispatched`
            : `Mapping "${mapping.id}" has no resolved classification (${String(classification)}) - cannot derive an operation from it`
      };
    }
  }

  if (operations.length === 0) {
    return { ok: false, reason: `Scene "${scenePlanId}" has no resolvable operations (no mapping with a manifest-linked placeholder and a set value)` };
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
      sourceProjectSha256: currentPlan.sourceProjectSha256,
      sourceProjectPath: currentProjectManifest.sourceProject.path,
      scenePlanId,
      manifestCompositionId: scene.manifestCompositionId,
      aeProjectItemIndex: composition.aeProjectItemIndex,
      compositionName: composition.name,
      approvedMappingIds,
      operations
    }
  };
}
