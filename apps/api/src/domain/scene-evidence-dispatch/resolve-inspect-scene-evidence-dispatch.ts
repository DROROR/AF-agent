import { MAX_LAYERS_PER_SCENE_EVIDENCE_REQUEST, type ScenePlanEntry, type SceneEvidenceRequest, type TemplateManifest } from "@dyo/schemas";
import { derivePreviewTimingTargets } from "../preview-timing/derive-preview-timing-targets.js";

export interface InspectSceneEvidenceDispatchPlanSnapshot {
  sourceProjectSha256: string;
  scenePlans: ScenePlanEntry[];
}

export interface ResolveInspectSceneEvidenceDispatchInput {
  scenePlanId: string;
  /** The CURRENT plan for this project, freshly read - null if none exists. */
  currentPlan: InspectSceneEvidenceDispatchPlanSnapshot | null;
  /** The project's CURRENT manifest, freshly read - null if the project doesn't exist. */
  currentProjectManifest: TemplateManifest | null;
  /** Live-QA "generic AE layer-discovery capability" requirement - forwarded verbatim into the resolved payload's own discoverLayerDetails field. Omitted/false preserves prior behavior exactly. */
  discoverLayerDetails?: boolean;
  /** Preview Timing Analysis (live QA, 2026-09-09) - see the previewTimingChainIndex branch below and derivePreviewTimingTargets's own doc comment. */
  previewTimingChainIndex?: number;
  /** Preview Timing Analysis composition-graph discovery (live QA, 2026-09-10) - see the previewTimingDiscoverCompositionId branch below and job-dispatch.ts's own doc comment on why this is the one deliberate exception to server-only addressing resolution. */
  previewTimingDiscoverCompositionId?: string;
  /** Preview Timing Analysis TARGETED HOST-LAYER LOOKUP (live QA, 2026-09-10 real incident) - required alongside previewTimingDiscoverCompositionId (which names the PARENT); this names the CHILD composition whose hosting layer(s) are being looked up. See job-dispatch.ts's own doc comment. */
  previewTimingFindHostLayersChildCompositionId?: string;
  /** Real 2026-09-10 incident (session a7fee3d9) - the OTHER thing previewTimingDiscoverCompositionId can be used for: describe THAT composition's own top-level duration/work-area/layer-timing facts (buildDescribeCompositionSummaryScript), rather than looking up where it hosts some other child. Mutually exclusive with previewTimingFindHostLayersChildCompositionId by construction - see the branch below. */
  previewTimingDescribeCompositionSummary?: boolean;
}

export type ResolveInspectSceneEvidenceDispatchResult =
  | { ok: true; payload: SceneEvidenceRequest }
  | { ok: false; reason: string };

/**
 * Offline-safe-control-plane phase, section 2: "server must resolve the
 * source project / working source reference from trusted project
 * inspection/job/manifest state already stored by DYO... DO NOT invent a
 * path, DO NOT allow arbitrary path input." Mirrors
 * resolveExecuteFrameDispatch's own "browser supplies only projectId +
 * scenePlanId, everything else is server-resolved from trusted state"
 * pattern (see that file's own doc comment) - `sourceProjectPath` in
 * particular is always `currentProjectManifest.sourceProject.path`, the
 * exact same trusted source EXECUTE_FRAME/RENDER already use, never a
 * caller-supplied string.
 *
 * `layerIndices` is ALSO resolved here, not merely the addressing fields -
 * every placeholder's own `layerIndex` for the scene's manifest
 * composition, deduplicated and capped at
 * MAX_LAYERS_PER_SCENE_EVIDENCE_REQUEST. A normal user (or any caller)
 * never needs to know or supply AE layer indices at all.
 *
 * A composition with ZERO placeholders (or no `manifest.scenes` entry at
 * all - e.g. a composition classified `isNestedOnlyReferenced` at the flat
 * manifest level but promoted to a real, client-facing scene by
 * real-scene-grouping.ts's own graph walk) still resolves successfully,
 * with `layerIndices: []` (live QA Blocker 2 fix, 2026-09-07). Per-layer
 * evidence and the real representative frame capture below are genuinely
 * independent worker-side operations (see
 * heroic-swan-scene-evidence-inspector.ts's own two separate code paths -
 * the `ae_capture_frame` block never reads `layerIndices`), so there was
 * never a real reason a scene with nothing editable couldn't still get a
 * real visual preview. Composition identity itself (aeProjectItemIndex/
 * compositionName, verified worker-side before ANY evidence is ever
 * reported) stays exactly as fail-closed as before - this only removes an
 * unrelated, overly-broad early refusal for the layer-count case.
 *
 * Deliberately does NOT require the plan to be APPROVED, and does NOT gate
 * on `scene.use`/`approvalState` - unlike EXECUTE_FRAME, this operation is
 * read-only (see CLAUDE.md/scene-evidence.ts: no save, no mutation) and is
 * meant to inform Mapping Assistant confidence BEFORE a scene is approved,
 * not after.
 */
export function resolveInspectSceneEvidenceDispatch(input: ResolveInspectSceneEvidenceDispatchInput): ResolveInspectSceneEvidenceDispatchResult {
  const {
    scenePlanId,
    currentPlan,
    currentProjectManifest,
    discoverLayerDetails,
    previewTimingChainIndex,
    previewTimingDiscoverCompositionId,
    previewTimingFindHostLayersChildCompositionId,
    previewTimingDescribeCompositionSummary
  } = input;

  if (!currentPlan) {
    return { ok: false, reason: "No execution plan exists for this project yet" };
  }
  if (!currentProjectManifest) {
    return { ok: false, reason: "Project manifest is not available" };
  }
  if (currentProjectManifest.sourceProject.sha256 !== currentPlan.sourceProjectSha256) {
    return {
      ok: false,
      reason: "The project's current manifest sha256 no longer matches this plan - the source project may have changed"
    };
  }

  const scene = currentPlan.scenePlans.find((s) => s.id === scenePlanId);
  if (!scene) {
    return { ok: false, reason: `Unknown scenePlanId "${scenePlanId}" in this plan` };
  }

  // Preview Timing Analysis TARGETED HOST-LAYER LOOKUP (live QA,
  // 2026-09-10 real incident) - checked BEFORE previewTimingChainIndex
  // below. The ONE caller-supplied compositionId(s) this codebase ever
  // accepts for addressing purposes - see job-dispatch.ts's own doc
  // comment for the full safety reasoning (read-only, both parent and
  // child validated against THIS project's own current manifest, never an
  // arbitrary string).
  //
  // This REPLACES the prior "discovery mode scan of the WHOLE parent,
  // optionally with an early-exit target hint" branch: a real retry
  // proved that even a trimmed, early-exiting full-layer scan still times
  // out on a large parent composition (the real incident: "!Render",
  // ~40+ layers), since per-layer classification/object-construction cost
  // alone - not merely the property reads a caller could already opt out
  // of - was the bottleneck. `previewTimingFindHostLayersChildCompositionId`
  // is now REQUIRED alongside `previewTimingDiscoverCompositionId` - there
  // is no longer a broad "just scan this whole composition" mode for
  // graph discovery, only a genuinely targeted parent->child edge lookup.
  if (previewTimingDiscoverCompositionId !== undefined) {
    const parentComposition = currentProjectManifest.compositions.find((c) => c.compositionId === previewTimingDiscoverCompositionId);
    if (!parentComposition) {
      return {
        ok: false,
        reason: `Preview-timing discovery parent compositionId "${previewTimingDiscoverCompositionId}" does not match any composition in the current manifest - refusing to inspect an unknown composition`
      };
    }

    // Real 2026-09-10 incident (session a7fee3d9) - describe THIS
    // composition's own top-level duration/work-area/layer-timing facts,
    // rather than looking up where it hosts some other child. Checked
    // first: mutually exclusive with the host-layer-lookup branch below by
    // construction (the resolver never sets both on the same dispatch).
    if (previewTimingDescribeCompositionSummary === true) {
      return {
        ok: true,
        payload: {
          sourceProjectPath: currentProjectManifest.sourceProject.path,
          sourceProjectSha256: currentPlan.sourceProjectSha256,
          manifestCompositionId: previewTimingDiscoverCompositionId,
          aeProjectItemIndex: parentComposition.aeProjectItemIndex,
          compositionName: parentComposition.name,
          // Entirely self-sufficient (the worker scans this composition's
          // own immediate layers itself) - no caller/server-supplied
          // layerIndices needed.
          layerIndices: [],
          previewTimestampSeconds: null,
          describeCompositionSummary: true
        }
      };
    }

    if (previewTimingFindHostLayersChildCompositionId === undefined) {
      return {
        ok: false,
        reason: "Preview-timing discovery requires previewTimingFindHostLayersChildCompositionId or previewTimingDescribeCompositionSummary alongside previewTimingDiscoverCompositionId - a targeted host-layer lookup always names both the parent and the child, and a composition summary always names which composition to describe."
      };
    }
    const knownChild = currentProjectManifest.compositions.some((c) => c.compositionId === previewTimingFindHostLayersChildCompositionId);
    if (!knownChild) {
      return {
        ok: false,
        reason: `Preview-timing discovery target compositionId "${previewTimingFindHostLayersChildCompositionId}" does not match any composition in the current manifest - refusing to search for an unknown composition`
      };
    }
    return {
      ok: true,
      payload: {
        sourceProjectPath: currentProjectManifest.sourceProject.path,
        sourceProjectSha256: currentPlan.sourceProjectSha256,
        manifestCompositionId: previewTimingDiscoverCompositionId,
        aeProjectItemIndex: parentComposition.aeProjectItemIndex,
        compositionName: parentComposition.name,
        // The new targeted host-layer lookup is entirely self-sufficient
        // (it scans the parent's own immediate layers itself, server-side
        // in the Worker) - no caller/server-supplied layerIndices needed.
        layerIndices: [],
        previewTimestampSeconds: null,
        // Targeted host-layer lookup (live QA, 2026-09-10 real incident):
        // scans ONLY the parent's own immediate layers, doing zero
        // classification/object-construction work for a non-matching
        // layer, and never breaks early - every real instance of the
        // child composition is reported. See jsx-templates.ts's own
        // buildFindHostLayersScript doc comment.
        findHostLayersForChildCompositionId: previewTimingFindHostLayersChildCompositionId
      }
    };
  }

  // Preview Timing Analysis (live QA, 2026-09-09, extended to arbitrary
  // nested depth 2026-09-10) - a completely different target composition
  // than the scene's own manifestCompositionId dispatch below, derived
  // ONLY from this scene's own real, approved mappings' COMPLETE
  // humanNestedTarget chains (never a caller-supplied compositionId/
  // layerIndices) - see derivePreviewTimingTargets's own doc comment.
  if (previewTimingChainIndex !== undefined) {
    const targets = derivePreviewTimingTargets(scene);
    const target = targets[previewTimingChainIndex];
    if (!target) {
      return {
        ok: false,
        reason: `Scene "${scenePlanId}" has no preview-timing target at chain index ${previewTimingChainIndex} (only ${targets.length} distinct nested composition(s) found in its own approved mappings)`
      };
    }
    const targetComposition = currentProjectManifest.compositions.find((c) => c.compositionId === target.compositionId);
    if (!targetComposition) {
      return { ok: false, reason: `Preview-timing target compositionId "${target.compositionId}" does not match any composition in the current manifest` };
    }
    return {
      ok: true,
      payload: {
        sourceProjectPath: currentProjectManifest.sourceProject.path,
        sourceProjectSha256: currentPlan.sourceProjectSha256,
        manifestCompositionId: target.compositionId,
        aeProjectItemIndex: targetComposition.aeProjectItemIndex,
        compositionName: targetComposition.name,
        layerIndices: target.layerIndices,
        // No representative frame needed for a timing-only request - this
        // never captures or uploads a preview image.
        previewTimestampSeconds: null,
        // Always required for this feature - stretchPercent/timeRemapEnabled
        // (Preview Timing Analysis's own new evidence fields) are only ever
        // populated via this flag.
        discoverLayerDetails: true
      }
    };
  }

  const composition = currentProjectManifest.compositions.find((c) => c.compositionId === scene.manifestCompositionId);
  if (!composition) {
    return { ok: false, reason: `manifestCompositionId "${scene.manifestCompositionId}" does not match any composition in the current manifest` };
  }
  const manifestScene = currentProjectManifest.scenes.find((s) => s.compositionId === scene.manifestCompositionId);

  const layerIndices = [...new Set((manifestScene?.placeholders ?? []).map((placeholder) => placeholder.layerIndex))]
    .sort((a, b) => a - b)
    .slice(0, MAX_LAYERS_PER_SCENE_EVIDENCE_REQUEST);

  return {
    ok: true,
    payload: {
      sourceProjectPath: currentProjectManifest.sourceProject.path,
      sourceProjectSha256: currentPlan.sourceProjectSha256,
      manifestCompositionId: scene.manifestCompositionId,
      aeProjectItemIndex: composition.aeProjectItemIndex,
      compositionName: composition.name,
      // Legitimately empty for a composition with no editable placeholders
      // - never refused merely for that (see this function's own doc
      // comment). A real frame capture still happens below either way.
      layerIndices,
      // Client-facing UX redesign, "M. VISUAL PREVIEWS ARE MANDATORY":
      // always request a real representative frame now (deterministic,
      // server-resolved - the very start of the composition - never a
      // caller-supplied timestamp). A failed capture never fails the
      // whole evidence result (see SceneEvidenceResponse.preview's own
      // doc comment) - the structural layer facts remain useful on
      // their own either way.
      previewTimestampSeconds: 0,
      ...(discoverLayerDetails === true ? { discoverLayerDetails: true } : {})
    }
  };
}
