import { describeTemplateCopyBlockers, findTemplateCopyBlockers } from "../execution-plan/evaluate-template-copy.js";
import { computeEffectiveVisibility, describeSlotBlockers, findSlotBlockers, selectScenePreviewFrameSeconds } from "@dyo/schemas";
import type {
  ExecuteSceneEditRequest,
  ExecutionSessionStatus,
  NestedTargetStep,
  PlanStatus,
  ResolvedNestedTargetStep,
  SceneEditOperationIntent,
  ScenePlanEntry,
  TemplateManifest,
  WorkerCapability
} from "@dyo/schemas";
import { TERMINAL_EXECUTION_SESSION_STATUSES } from "@dyo/schemas";
import { isHeartbeatStale } from "../worker/rules.js";
import type { SceneEditWorkerSnapshot } from "../execute-scene-edit/validate-scene-edit-preconditions.js";
import type { AssetRecord } from "../asset/types.js";
import { verifyNestedTargetPath } from "../execution-plan/verify-nested-target-path.js";
import { isRecoverableForPreviewRegeneration } from "../execution-session/is-session-active.js";

/**
 * Live QA execution-wiring fix (2026-09-08): re-verifies a human-added
 * mapping's persisted humanNestedTarget against the CURRENT manifest (the
 * SAME evidence-based ancestry check apply-execution-plan-edit.ts already
 * ran once at ADD_MAPPING time - never trusted as still-valid forever,
 * since the project's manifest is the only source of truth for what's
 * really there), then resolves each step's own real, freshly-read
 * `aeProjectItemIndex` from that manifest - never persisted on the
 * mapping, never stale, the exact same freshness guarantee the top-level
 * scene composition's own aeProjectItemIndex already gets on every single
 * dispatch.
 */
function resolveHumanNestedTarget(
  steps: readonly NestedTargetStep[],
  manifest: TemplateManifest,
  ownerCompositionId: string
): { ok: true; resolved: ResolvedNestedTargetStep[] } | { ok: false; reason: string } {
  const chainError = verifyNestedTargetPath(manifest, ownerCompositionId, steps);
  if (chainError) {
    return { ok: false, reason: chainError };
  }
  const compositionById = new Map(manifest.compositions.map((c) => [c.compositionId, c]));
  const resolved: ResolvedNestedTargetStep[] = [];
  for (const step of steps) {
    const composition = compositionById.get(step.compositionId);
    if (!composition) {
      // Unreachable given verifyNestedTargetPath already confirmed this
      // exact composition exists above - defensive only, never trusts its
      // own earlier check without re-deriving here too.
      return { ok: false, reason: `humanNestedTarget step references compositionId "${step.compositionId}" which does not exist in the current manifest` };
    }
    resolved.push({ compositionId: step.compositionId, aeProjectItemIndex: composition.aeProjectItemIndex, layerIndex: step.layerIndex });
  }
  return { ok: true, resolved };
}

/**
 * The real WorkerCapability this dispatches as - already in
 * WORKER_CAPABILITIES/CLAUDE.md's fixed allowlist, never a new capability
 * name invented for this feature.
 */
const REQUIRED_WORKER_CAPABILITY: WorkerCapability = "EXECUTE_FRAME";

/** Manifest classification values MAP_FOOTAGE can resolve today - every one names an asset-bearing placeholder type. */
/** Exported so apply-execution-plan-edit.ts's own ADD_MAPPING handling uses the exact same asset-vs-text classification split as real EXECUTE_FRAME dispatch resolution - never a second, divergent list. */
export const ASSET_CLASSIFICATIONS = ["image", "video", "logo", "phone_screen"] as const;

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
  /** First Preview regeneration (live QA, 2026-09-08/09) - the scene a previewOnly dispatch targets; see the previewOnly branch below. */
  latestPreviewScenePlanId: string | null;
  /** First Preview regeneration trust flag (live QA, 2026-09-09) - see schema.ts's own doc comment and isRecoverableForPreviewRegeneration's own doc comment. */
  workingCopyTrusted: boolean;
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
  /**
   * First Preview regeneration (live QA, 2026-09-08/09) - see the
   * previewOnly branch below and executeSceneEditRequestSchema's own
   * previewOnly doc comment. Omitted/false preserves every existing
   * caller's exact prior behavior untouched.
   */
  regeneratePreviewOnly?: boolean;
  /** Only meaningful alongside regeneratePreviewOnly. */
  previewTimestampSeconds?: number;
  /**
   * Landscape output-composition build (live QA, 2026-09-10 urgent
   * request) - see resolveBuildHorizontalCompositionOnly's own doc
   * comment below. Omitted/false preserves every existing caller's exact
   * prior behavior untouched.
   */
  buildHorizontalCompositionOnly?: boolean;
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
/**
 * REAL 2026-09-16 FINDING (session 1257ac95): a logo cover-fitted onto a tall
 * screen card was cropped to a slice. A mapping approved as a logo asks the
 * worker to show the whole logo, centred and unstretched; every other asset
 * keeps the default cover fit, so its payload is unchanged.
 */
function logoFit(mapping: { selectedAssetType?: string | null }): { fit: "contain" } | Record<string, never> {
  return mapping.selectedAssetType === "logo" ? { fit: "contain" } : {};
}

export function resolveExecuteFrameDispatch(input: ResolveExecuteFrameDispatchInput): ResolveExecuteFrameDispatchResult {
  const { projectId, scenePlanId, session, currentPlan, currentProjectManifest, projectAssets, worker, now, staleAfterMs } = input;

  if (!session) {
    return { ok: false, reason: "No execution session was found for the requested executionSessionId - start one first" };
  }
  if (session.projectId !== projectId) {
    return { ok: false, reason: "The execution session does not belong to this project" };
  }

  // First Preview regeneration (live QA, 2026-09-08/09 incident: a
  // captured preview landed at t=0 on a solid background color, before
  // any branding was visible; the operator rejected it, which - by
  // design, section 11's "no revise in place" for a genuinely bad edit -
  // marks the session FAILED. That design never anticipated "the edit is
  // fine, only the captured FRAME was unrepresentative" as a distinct
  // case.) A previewOnly dispatch deliberately bypasses the two checks
  // right below (terminal-session, already-edited) - both are correct for
  // a NEW edit, both are exactly wrong for "recapture the existing,
  // already-safely-verified working copy at a different timestamp,
  // nothing else changes." See resolveRegeneratePreviewOnly's own doc
  // comment for its distinct, narrower preconditions.
  if (input.regeneratePreviewOnly === true) {
    return resolveRegeneratePreviewOnly(input, session);
  }

  // Landscape output-composition build (live QA, 2026-09-10 urgent
  // request) - deliberately bypasses the "already edited" check right
  // below (the OPPOSITE precondition of a normal edit: this scene's own
  // real, approved content must ALREADY be baked into the working copy
  // before it is safe to duplicate/adapt it - see
  // resolveBuildHorizontalCompositionOnly's own doc comment).
  if (input.buildHorizontalCompositionOnly === true) {
    return resolveBuildHorizontalCompositionOnly(input, session);
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

  // Leftover template copy blocks EXECUTION too, not only approval: a plan
  // approved before this gate existed, or one whose manifest never captured
  // the template's own text, must not quietly execute template wording.
  const templateCopyBlockers = findTemplateCopyBlockers([scene], currentProjectManifest);
  if (templateCopyBlockers.length > 0) {
    return { ok: false, reason: `Scene "${scenePlanId}" still contains unreviewed template copy: ${describeTemplateCopyBlockers(templateCopyBlockers).join(" | ")}` };
  }

  // SLOT SEMANTICS AND FIT (Stage 4) block execution for the same reason: a
  // plan approved before this gate existed must not quietly drop a logo into
  // a phone screen or stretch a screenshot across a card.
  const slotAssetFacts = new Map(
    (projectAssets ?? []).map((asset) => [asset.id, {
        id: asset.id,
        widthPx: asset.width ?? null,
        heightPx: asset.height ?? null,
        hasAlphaChannel: asset.hasAlphaChannel ?? null,
        hasTransparentPixels: asset.hasTransparentPixels ?? null,
        transparentPixelRatio: asset.transparentPixelRatio ?? null,
        visibleCoverageRatio: asset.visibleCoverageRatio ?? null,
        visibleContentBounds: asset.visibleContentBounds ?? null
      }])
  );
  // An asset that has been DELETED is reported as deleted. The slot gate would
  // otherwise describe it as "dimensions unknown" - true, but it sends a
  // reviewer looking for a measurement problem instead of a missing file. The
  // same refusal is repeated per operation below, for mappings this scene-wide
  // check cannot see.
  if (projectAssets !== undefined) {
    const deleted = scene.mappings.find((mapping) => mapping.selectedAssetId !== null && !slotAssetFacts.has(mapping.selectedAssetId));
    if (deleted) {
      return { ok: false, reason: `Mapping "${deleted.id}"'s selected asset "${deleted.selectedAssetId}" no longer exists in this project's Asset Catalog` };
    }
  }

  const slotBlockers = findSlotBlockers([scene], currentProjectManifest, slotAssetFacts);
  if (slotBlockers.length > 0) {
    return { ok: false, reason: `Scene "${scenePlanId}" has unresolved slot findings: ${describeSlotBlockers(slotBlockers).join(" | ")}` };
  }

  const composition = currentProjectManifest.compositions.find((c) => c.compositionId === scene.manifestCompositionId);
  if (!composition) {
    return { ok: false, reason: `manifestCompositionId "${scene.manifestCompositionId}" does not match any composition in the current manifest` };
  }
  const manifestScene = currentProjectManifest.scenes.find((s) => s.compositionId === scene.manifestCompositionId);

  // CROSS-SCENE SHARED LAYERS (code review findings, 2026-09-13). A layer
  // inside a precomp used by several scenes is ONE layer in the working copy,
  // and inspection lists it under every scene that reaches it (so no chosen
  // scene is ever left without a placeholder for its own visible content).
  // The hazard is two INCLUDED scenes writing DIFFERENT values to it: both
  // pass every per-scene check, and whichever executes last silently
  // overwrites the other's approved content. That is refused here, before
  // anything runs. The same value in both, an unset value, or an excluded
  // scene is not a conflict - the edit genuinely applies wherever the precomp
  // appears.
  type WriteTarget = { key: string; compositionId: string; layerIndex: number };
  const resolveWriteTarget = (mapping: (typeof scene.mappings)[number], owner: typeof scene): WriteTarget | null => {
    if (mapping.manifestPlaceholderId !== null) {
      const ownerManifestScene = currentProjectManifest.scenes.find((s) => s.compositionId === owner.manifestCompositionId);
      const target = ownerManifestScene?.placeholders.find((p) => p.placeholderId === mapping.manifestPlaceholderId);
      return target
        ? { key: `${target.compositionId} ${target.layerIndex}`, compositionId: target.compositionId, layerIndex: target.layerIndex }
        : null;
    }
    const lastHop = mapping.humanNestedTarget?.at(-1);
    if (lastHop) {
      return { key: `${lastHop.compositionId} ${lastHop.layerIndex}`, compositionId: lastHop.compositionId, layerIndex: lastHop.layerIndex };
    }
    if (mapping.humanLayerIndex !== null) {
      return {
        key: `${owner.manifestCompositionId} ${mapping.humanLayerIndex}`,
        compositionId: owner.manifestCompositionId,
        layerIndex: mapping.humanLayerIndex
      };
    }
    return null;
  };
  const resolveWrittenValue = (mapping: (typeof scene.mappings)[number]): string | null => {
    const classification = mapping.placeholderClassification.value;
    if (classification === "text" && mapping.text !== null) {
      return `text ${JSON.stringify(mapping.text)}`;
    }
    if ((ASSET_CLASSIFICATIONS as readonly string[]).includes(classification ?? "") && mapping.selectedAssetId !== null) {
      return `asset ${mapping.selectedAssetId}`;
    }
    return null;
  };
  const writesByOtherIncludedScenes = new Map<string, { value: string; compositionName: string }[]>();
  for (const other of currentPlan.scenePlans) {
    if (other.id === scene.id || !other.use) {
      continue;
    }
    for (const otherMapping of other.mappings) {
      const target = resolveWriteTarget(otherMapping, other);
      const value = resolveWrittenValue(otherMapping);
      if (target === null || value === null) {
        continue;
      }
      const writes = writesByOtherIncludedScenes.get(target.key) ?? [];
      writes.push({ value, compositionName: other.compositionName });
      writesByOtherIncludedScenes.set(target.key, writes);
    }
  }
  // The same hazard INSIDE the scene being dispatched (code review finding,
  // 2026-09-13): a manifest mapping to a nested placeholder and a human-added
  // mapping whose humanNestedTarget names that same layer would otherwise
  // produce two SET_TEXT/MAP_FOOTAGE operations on one layer, last one wins.
  const ownWrites = new Map<string, string>();
  for (const ownMapping of scene.mappings) {
    const target = resolveWriteTarget(ownMapping, scene);
    const value = resolveWrittenValue(ownMapping);
    if (target === null || value === null) {
      continue;
    }
    const earlierOwnValue = ownWrites.get(target.key);
    if (earlierOwnValue !== undefined && earlierOwnValue !== value) {
      return {
        ok: false,
        reason: `Scene "${scene.compositionName}" has two mappings that set different content on the same After Effects layer (composition "${target.compositionId}" layer ${target.layerIndex}) - one would silently overwrite the other. Remove or align the duplicate mapping before dispatching.`
      };
    }
    ownWrites.set(target.key, value);
    const conflict = writesByOtherIncludedScenes.get(target.key)?.find((write) => write.value !== value);
    if (conflict) {
      return {
        ok: false,
        reason: `Scene "${scene.compositionName}" and scene "${conflict.compositionName}" set different content on the same shared After Effects layer (composition "${target.compositionId}" layer ${target.layerIndex}). That layer lives in a precomp both scenes use, so it is one layer in the working copy - whichever scene ran last would silently overwrite the other's approved content. Make the two scenes agree, or clear one of them, before dispatching.`
      };
    }
  }

  const assetsById = new Map(projectAssets.map((asset) => [asset.id, asset]));
  const operations: SceneEditOperationIntent[] = [];
  const approvedMappingIds: string[] = [];

  for (const mapping of scene.mappings) {
    if (mapping.manifestPlaceholderId === null) {
      // A purely informational human-added mapping (no real, verified AE
      // layer target - execution-plan.ts's own humanLayerIndex doc
      // comment) is inert here, unchanged from before that field existed.
      if (mapping.humanLayerIndex === null && mapping.humanNestedTarget === null) {
        continue;
      }

      // Live QA execution-wiring fix (2026-09-08): a human-added mapping
      // WITH a real, verified target is now translated into a real
      // dispatchable operation - the exact same classification-driven
      // SET_TEXT/MAP_FOOTAGE derivation the manifest-linked path below
      // already uses, just addressed by humanLayerIndex/humanNestedTarget
      // instead of a manifest Placeholder's own layerIndex. Never silently
      // dropped, and never a second, divergent validation path - a
      // classification this branch cannot resolve into an operation still
      // fails the WHOLE scene closed, exactly as it always has.
      const classification = mapping.placeholderClassification.value;
      let nestedTarget: ResolvedNestedTargetStep[] | null = null;
      if (mapping.humanNestedTarget !== null) {
        const resolved = resolveHumanNestedTarget(mapping.humanNestedTarget, currentProjectManifest, scene.manifestCompositionId);
        if (!resolved.ok) {
          return { ok: false, reason: `Mapping "${mapping.id}"'s humanNestedTarget is no longer valid: ${resolved.reason}` };
        }
        nestedTarget = resolved.resolved;
      }
      const layerIndex = mapping.humanLayerIndex;

      if (classification === "text") {
        if (mapping.text === null) {
          return { ok: false, reason: `Mapping "${mapping.id}" is a human-added text mapping but has no text set` };
        }
        operations.push({ type: "SET_TEXT", manifestPlaceholderId: null, layerIndex, nestedTarget, text: mapping.text });
        approvedMappingIds.push(mapping.id);
      } else if ((ASSET_CLASSIFICATIONS as readonly string[]).includes(classification ?? "")) {
        if (mapping.selectedAssetId === null) {
          return { ok: false, reason: `Mapping "${mapping.id}" is a human-added ${classification} mapping but has no selectedAssetId set` };
        }
        const asset = assetsById.get(mapping.selectedAssetId);
        if (!asset) {
          return { ok: false, reason: `Mapping "${mapping.id}"'s selected asset "${mapping.selectedAssetId}" no longer exists in this project's Asset Catalog` };
        }
        operations.push({
          type: "MAP_FOOTAGE",
          manifestPlaceholderId: null,
          layerIndex,
          nestedTarget,
          assetId: asset.id,
          expectedSha256: asset.sha256,
          mimeType: asset.mimeType,
          ...logoFit(mapping)
        });
        approvedMappingIds.push(mapping.id);
      } else {
        return {
          ok: false,
          reason: `Mapping "${mapping.id}" is a human-added mapping with a real AE target but an unsupported placeholderClassification (${String(classification)}) - only "text" or an asset type (image/video/logo/phone_screen) can be dispatched today`
        };
      }
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

    // NESTED MANIFEST PLACEHOLDERS (2026-09-13). Inspection now surfaces
    // editable layers found INSIDE precomps. Such a placeholder's layerIndex
    // is an index within ITS OWN composition, not the scene's - so treating
    // it as a same-composition edit (as every manifest-linked operation here
    // used to, with `nestedTarget: null`) would silently edit whatever layer
    // happens to sit at that index in the scene's top composition. On the
    // template this was built for, that is a CONTROLS solid.
    //
    // Two independent guarantees:
    //  1. A placeholder whose composition is not the scene's own MUST carry
    //     a verified chain, or dispatch refuses. This is the backstop for a
    //     manifest that lost `nestedTarget` - e.g. stripped by an older API,
    //     since the manifest schema does not reject unknown keys.
    //  2. The chain is re-verified against the CURRENT manifest's composition
    //     graph with the exact same check a human nested target gets.
    const placeholderNestedTarget = placeholder.nestedTarget ?? null;
    const livesInSceneComposition = placeholder.compositionId === scene.manifestCompositionId;
    if (placeholderNestedTarget === null && !livesInSceneComposition) {
      return {
        ok: false,
        reason: `Mapping "${mapping.id}" targets placeholder "${placeholder.placeholderId}" in composition "${placeholder.compositionId}", which is not this scene's own composition "${scene.manifestCompositionId}", and the manifest carries no nested target path for it - refusing to dispatch rather than edit layer ${placeholder.layerIndex} of the wrong composition`
      };
    }
    let manifestNestedTarget: ResolvedNestedTargetStep[] | null = null;
    if (placeholderNestedTarget !== null) {
      const finalStep = placeholderNestedTarget[placeholderNestedTarget.length - 1];
      if (
        livesInSceneComposition ||
        !finalStep ||
        finalStep.compositionId !== placeholder.compositionId ||
        finalStep.layerIndex !== placeholder.layerIndex
      ) {
        return {
          ok: false,
          reason: `Mapping "${mapping.id}" targets placeholder "${placeholder.placeholderId}" whose nested target path does not end at its own composition "${placeholder.compositionId}" layer ${placeholder.layerIndex} - an internally inconsistent manifest entry, refusing to guess which layer is meant`
        };
      }
      const resolved = resolveHumanNestedTarget(placeholderNestedTarget, currentProjectManifest, scene.manifestCompositionId);
      if (!resolved.ok) {
        return { ok: false, reason: `Mapping "${mapping.id}"'s manifest nested target is no longer valid: ${resolved.reason}` };
      }
      manifestNestedTarget = resolved.resolved;
      if (layerVisible !== null || freezeAtSeconds !== null || layerDurationSeconds !== null) {
        return {
          ok: false,
          reason: `Mapping "${mapping.id}" targets a layer inside a nested composition ("${placeholder.compositionId}" layer ${placeholder.layerIndex}), but SET_LAYER_VISIBILITY / SET_TIME_REMAP_FREEZE / SET_DURATION can only target a layer in the scene's own composition today - refusing rather than applying it to layer ${placeholder.layerIndex} of "${scene.manifestCompositionId}"`
        };
      }
    }

    const classification = mapping.placeholderClassification.value;
    if (classification === "text") {
      if (mapping.text === null) {
        return { ok: false, reason: `Mapping "${mapping.id}" is classified as text but has no text set` };
      }
      operations.push({
        type: "SET_TEXT",
        manifestPlaceholderId: mapping.manifestPlaceholderId,
        layerIndex: manifestNestedTarget === null ? placeholder.layerIndex : null,
        nestedTarget: manifestNestedTarget,
        text: mapping.text
      });
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
        layerIndex: manifestNestedTarget === null ? placeholder.layerIndex : null,
        nestedTarget: manifestNestedTarget,
        assetId: asset.id,
        expectedSha256: asset.sha256,
        mimeType: asset.mimeType,
        // Stage 4: the structure this slot had when the plan was approved. The
        // worker re-reads it live and refuses to mutate if it has changed.
        ...(placeholder.slotMutationFingerprint ? { expectedSlotFingerprint: placeholder.slotMutationFingerprint } : {}),
        ...logoFit(mapping)
      });
      approvedMappingIds.push(mapping.id);
    } else if (classification === "color") {
      // Nested color placeholders are never emitted by inspection (see
      // build-manifest.ts decideNestedLayer), but this path must not trust
      // that: SET_BRAND_COLOR has no nested form, so recoloring "layer N"
      // here would hit the scene's own layer N.
      if (manifestNestedTarget !== null) {
        return {
          ok: false,
          reason: `Mapping "${mapping.id}" is a color placeholder inside a nested composition ("${placeholder.compositionId}" layer ${placeholder.layerIndex}), but SET_BRAND_COLOR can only target a layer in the scene's own composition today - refusing rather than recoloring layer ${placeholder.layerIndex} of "${scene.manifestCompositionId}"`
        };
      }
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

  // Native Reels composition (2026-08-29 closure requirement, section 1) -
  // ALWAYS the LAST operation for this scene, so it duplicates the
  // landscape composition only AFTER this same job's own content
  // operations above have already been applied to it - the duplicate
  // therefore carries the real, approved content, never template
  // placeholder text. A scene with no reelsLayout configured is completely
  // unaffected (landscape-only output, exactly as before this feature
  // existed).
  if (scene.reelsLayout) {
    operations.push({
      type: "BUILD_REELS_COMPOSITION",
      reelsCompositionName: scene.reelsLayout.reelsCompositionName,
      layerTransforms: scene.reelsLayout.layerTransforms
    });
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

  // THE PREVIEW MUST SHOW WHAT WAS JUST EDITED (2026-09-22 smoke-test
  // finding). This dispatch used to leave previewTimestampSeconds unset, and
  // the worker then captured t=0 unconditionally. A scene's layers routinely
  // do not start at t=0, so the frame a human is asked to approve at the
  // "first designed frame" gate was frequently blank - the QA fixture's frame
  // came back fully transparent, with every check around it passing.
  //
  // The moment is resolved SERVER-side from the manifest's own Stage 4
  // structural facts, exactly as a slot evidence frame already is, and never
  // supplied by the browser: take each edited slot's effectively-visible
  // window (enabled, in frame, opacity above the visible threshold) and pick
  // the moment the most of them overlap. Slots with no provable window
  // contribute nothing rather than dragging the answer towards a moment that
  // shows nothing.
  //
  // Text and colour placeholders carry no slot facts by design (Stage 4 never
  // judges them), so they simply do not vote here.
  //
  // When NOTHING is measurable - a manifest written before slot facts existed,
  // or a scene whose hosts were all unreadable - previewTimestampSeconds is
  // left unset and the worker's own long-standing t=0 default applies
  // unchanged, so no existing project's behaviour shifts silently.
  const editedSlotWindows = approvedMappingIds.map((mappingId) => {
    const mapping = scene.mappings.find((candidate) => candidate.id === mappingId);
    const placeholder = mapping?.manifestPlaceholderId ? manifestScene?.placeholders.find((p) => p.placeholderId === mapping.manifestPlaceholderId) : undefined;
    return placeholder?.slotFacts ? computeEffectiveVisibility(placeholder.slotFacts) : null;
  });
  // Only the slots this dispatch is actually editing vote here; the
  // regeneration path has no approved-mapping list of its own and falls back
  // to every manifest-linked slot in the scene (scenePreviewFrameSeconds).
  const previewTimestampSeconds = selectScenePreviewFrameSeconds(editedSlotWindows);

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
      operations,
      ...(previewTimestampSeconds !== null ? { previewTimestampSeconds } : {})
    }
  };
}

/**
 * First Preview regeneration (live QA, 2026-09-08/09) - a deliberately
 * NARROW, distinct precondition set from the normal edit path above:
 *   - the session must be AWAITING_PREVIEW_APPROVAL (recapture before
 *     deciding), or FAILED with real completed work already on record
 *     (completedScenePlanIds non-empty, a real latestWorkingProjectSha256,
 *     and a real latestPreviewScenePlanId) - i.e. genuinely reached the
 *     preview gate and was rejected there, never a session that failed
 *     for some OTHER reason (a chain-of-custody violation, or one that
 *     never got far enough to have a working copy at all). Any other
 *     FAILED session is refused exactly as before - this never becomes a
 *     general "un-fail any session" escape hatch.
 *   - targets EXACTLY session.latestPreviewScenePlanId - the scene the
 *     rejected (or about-to-be-reviewed) preview was actually captured
 *     for, never the caller-supplied scenePlanId blindly (checked for
 *     equality below as defense in depth against a caller/UI bug, but the
 *     session's own value is what's actually used).
 *   - produces operations: [] / approvedMappingIds: [] / previewOnly:
 *     true / expectedWorkingProjectSha256: session's own real value
 *     (never null - resuming the EXISTING mutated working copy is the
 *     entire point, never a fresh copy from source).
 */
function resolveRegeneratePreviewOnly(
  input: ResolveExecuteFrameDispatchInput,
  session: ExecuteFrameDispatchSessionSnapshot
): ResolveExecuteFrameDispatchResult {
  const { projectId, scenePlanId, currentPlan, currentProjectManifest, worker, now, staleAfterMs } = input;

  if (!currentPlan) {
    return { ok: false, reason: "No execution plan exists for this project" };
  }

  // Shared with getCurrentExecutionSession (apps/api) - see that
  // predicate's own doc comment for why (the 2026-09-09 fix: the
  // dashboard's own "current session" read must agree with this
  // resolver about which FAILED sessions are recoverable, or the UI
  // never even gets a chance to offer regeneration).
  const canRegenerate = session.status === "AWAITING_PREVIEW_APPROVAL" || isRecoverableForPreviewRegeneration(session, currentPlan.revision);
  if (!canRegenerate) {
    return {
      ok: false,
      reason: `Execution session is ${session.status} and does not have a recoverable First Preview to regenerate - start a new execution session to continue`
    };
  }
  if (session.latestWorkingProjectSha256 === null || session.latestPreviewScenePlanId === null) {
    return { ok: false, reason: "Execution session has no recorded working copy or prior preview to regenerate from" };
  }
  if (scenePlanId !== session.latestPreviewScenePlanId) {
    return {
      ok: false,
      reason: `Requested scenePlanId "${scenePlanId}" does not match this session's own last-previewed scene "${session.latestPreviewScenePlanId}"`
    };
  }
  if (currentPlan.status !== "APPROVED") {
    return { ok: false, reason: `Plan is ${currentPlan.status}, not APPROVED - a preview can only be regenerated from an approved plan` };
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

  const scene = currentPlan.scenePlans.find((s) => s.id === session.latestPreviewScenePlanId);
  if (!scene) {
    return { ok: false, reason: `Unknown scenePlanId "${session.latestPreviewScenePlanId}" in this plan` };
  }
  const composition = currentProjectManifest.compositions.find((c) => c.compositionId === scene.manifestCompositionId);
  if (!composition) {
    return { ok: false, reason: `manifestCompositionId "${scene.manifestCompositionId}" does not match any composition in the current manifest` };
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
      scenePlanId: session.latestPreviewScenePlanId,
      manifestCompositionId: scene.manifestCompositionId,
      aeProjectItemIndex: composition.aeProjectItemIndex,
      compositionName: composition.name,
      approvedMappingIds: [],
      operations: [],
      previewOnly: true,
      // A reviewer who asked for a SPECIFIC moment gets that moment - that is
      // what this regeneration path exists for. Otherwise it falls back to the
      // same server-resolved moment the original dispatch now uses (see the
      // comment on the normal path above), rather than to t=0. Before
      // 2026-09-22 an unspecified regeneration reproduced the blank frame it
      // was asked to replace.
      previewTimestampSeconds: input.previewTimestampSeconds ?? scenePreviewFrameSeconds(scene, currentProjectManifest) ?? undefined
    }
  };
}

/**
 * The moment at which the most of a scene's manifest-linked slots are
 * genuinely on screen, or null when none of them can be measured. Shared by
 * the normal dispatch and the regeneration path so both name the same frame.
 */
function scenePreviewFrameSeconds(
  scene: { mappings: readonly { manifestPlaceholderId: string | null }[]; manifestCompositionId: string },
  manifest: TemplateManifest
): number | null {
  const manifestScene = manifest.scenes.find((candidate) => candidate.compositionId === scene.manifestCompositionId);
  const windows = scene.mappings.map((mapping) => {
    const placeholder = mapping.manifestPlaceholderId ? manifestScene?.placeholders.find((p) => p.placeholderId === mapping.manifestPlaceholderId) : undefined;
    return placeholder?.slotFacts ? computeEffectiveVisibility(placeholder.slotFacts) : null;
  });
  return selectScenePreviewFrameSeconds(windows);
}

/**
 * Landscape output-composition build (live QA, 2026-09-10 urgent request:
 * "COMPLETE THE MISSING OUTPUT-COMPOSITION STAGE") - a deliberately
 * NARROW, distinct precondition set from the normal edit path above, same
 * "opt-in flag, own function" convention as resolveRegeneratePreviewOnly:
 *
 *   - targets the requested scenePlanId directly (unlike
 *     resolveRegeneratePreviewOnly, which always targets
 *     session.latestPreviewScenePlanId - this operation can reasonably
 *     apply to any scene, not only the one a preview was captured for).
 *   - requires this exact scenePlanId to ALREADY be in the session's own
 *     completedScenePlanIds - the OPPOSITE precondition of a normal edit
 *     dispatch (which requires it NOT yet completed): this scene's own
 *     real, approved content must already be baked into the working copy
 *     before it is safe to duplicate/adapt it. A scene that was never
 *     executed in this session has nothing real to build a Landscape
 *     master from.
 *   - requires session.workingCopyTrusted (the same trust flag First
 *     Preview regeneration already respects) - never builds a derived
 *     output composition on top of a working copy this session's own
 *     record no longer trusts.
 *   - does NOT require session.status to be non-terminal in the general
 *     sense session status matters for READY_TO_RENDER/EDITING (a session
 *     that has already reached READY_TO_RENDER, the expected real case
 *     today, is explicitly fine) - only genuinely terminal FAILED/
 *     COMPLETED sessions are refused, mirroring every other branch's own
 *     "start a new execution session" rule for those.
 *   - produces exactly ONE operation (BUILD_HORIZONTAL_COMPOSITION),
 *     never bundled with any SET_TEXT/MAP_FOOTAGE - "do not rerun
 *     MAP_FOOTAGE or SET_TEXT" (explicit operator instruction). Its own
 *     horizontalCompositionName is ALWAYS server-derived deterministically
 *     from the scene's own real, current composition name
 *     (`${compositionName} (Landscape)`) - never a caller-supplied string,
 *     no template-specific hardcoding.
 *   - approvedMappingIds: [] - a comp-level operation, not tied to any
 *     mapping (see executeSceneEditRequestSchema's own superRefine, which
 *     now explicitly allows this for an operations array made up entirely
 *     of comp-level operations).
 *   - expectedWorkingProjectSha256 is always the session's own real,
 *     current latestWorkingProjectSha256 (never null - there is never a
 *     "first" build-horizontal-only job; a working copy already exists by
 *     construction, since completedScenePlanIds is non-empty).
 */
function resolveBuildHorizontalCompositionOnly(
  input: ResolveExecuteFrameDispatchInput,
  session: ExecuteFrameDispatchSessionSnapshot
): ResolveExecuteFrameDispatchResult {
  const { projectId, scenePlanId, currentPlan, currentProjectManifest, worker, now, staleAfterMs } = input;

  if (session.status === "FAILED" || session.status === "COMPLETED") {
    return { ok: false, reason: `Execution session is ${session.status} - start a new execution session to continue` };
  }
  if (!session.workingCopyTrusted) {
    return { ok: false, reason: "Execution session's working copy is no longer trusted - start a new execution session to continue" };
  }
  if (!session.completedScenePlanIds.includes(scenePlanId)) {
    return {
      ok: false,
      reason: `Scene "${scenePlanId}" has not been executed in this session yet - a Landscape master can only be built from a scene's own already-executed, approved content`
    };
  }
  if (session.latestWorkingProjectSha256 === null) {
    return { ok: false, reason: "Execution session has no recorded working copy to build a Landscape master from" };
  }

  if (!currentPlan) {
    return { ok: false, reason: "No execution plan exists for this project" };
  }
  if (currentPlan.status !== "APPROVED") {
    return { ok: false, reason: `Plan is ${currentPlan.status}, not APPROVED - a Landscape master can only be built from an approved plan` };
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
  const composition = currentProjectManifest.compositions.find((c) => c.compositionId === scene.manifestCompositionId);
  if (!composition) {
    return { ok: false, reason: `manifestCompositionId "${scene.manifestCompositionId}" does not match any composition in the current manifest` };
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
      approvedMappingIds: [],
      operations: [{ type: "BUILD_HORIZONTAL_COMPOSITION", horizontalCompositionName: `${composition.name} (Landscape)` }]
    }
  };
}
