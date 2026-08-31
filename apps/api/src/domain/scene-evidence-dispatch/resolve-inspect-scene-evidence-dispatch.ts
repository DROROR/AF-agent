import { MAX_LAYERS_PER_SCENE_EVIDENCE_REQUEST, type ScenePlanEntry, type SceneEvidenceRequest, type TemplateManifest } from "@dyo/schemas";

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
 * Deliberately does NOT require the plan to be APPROVED, and does NOT gate
 * on `scene.use`/`approvalState` - unlike EXECUTE_FRAME, this operation is
 * read-only (see CLAUDE.md/scene-evidence.ts: no save, no mutation) and is
 * meant to inform Mapping Assistant confidence BEFORE a scene is approved,
 * not after.
 */
export function resolveInspectSceneEvidenceDispatch(input: ResolveInspectSceneEvidenceDispatchInput): ResolveInspectSceneEvidenceDispatchResult {
  const { scenePlanId, currentPlan, currentProjectManifest } = input;

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

  const composition = currentProjectManifest.compositions.find((c) => c.compositionId === scene.manifestCompositionId);
  if (!composition) {
    return { ok: false, reason: `manifestCompositionId "${scene.manifestCompositionId}" does not match any composition in the current manifest` };
  }
  const manifestScene = currentProjectManifest.scenes.find((s) => s.compositionId === scene.manifestCompositionId);

  const layerIndices = [...new Set((manifestScene?.placeholders ?? []).map((placeholder) => placeholder.layerIndex))]
    .sort((a, b) => a - b)
    .slice(0, MAX_LAYERS_PER_SCENE_EVIDENCE_REQUEST);
  if (layerIndices.length === 0) {
    return { ok: false, reason: `Scene "${scenePlanId}" has no placeholders to inspect` };
  }

  return {
    ok: true,
    payload: {
      sourceProjectPath: currentProjectManifest.sourceProject.path,
      sourceProjectSha256: currentPlan.sourceProjectSha256,
      manifestCompositionId: scene.manifestCompositionId,
      aeProjectItemIndex: composition.aeProjectItemIndex,
      compositionName: composition.name,
      layerIndices,
      // Client-facing UX redesign, "M. VISUAL PREVIEWS ARE MANDATORY":
      // always request a real representative frame now (deterministic,
      // server-resolved - the very start of the composition - never a
      // caller-supplied timestamp). A failed capture never fails the
      // whole evidence result (see SceneEvidenceResponse.preview's own
      // doc comment) - the structural layer facts remain useful on
      // their own either way.
      previewTimestampSeconds: 0
    }
  };
}
