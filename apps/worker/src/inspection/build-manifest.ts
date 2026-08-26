import {
  SCHEMA_VERSION,
  type Composition,
  type InspectionSummary,
  type Placeholder,
  type Scene,
  type TemplateManifest
} from "@dyo/schemas";
import { classifyPlaceholder } from "./classify-placeholder.js";
import { deterministicId } from "./deterministic-id.js";
import type { ProjectFacts } from "./project-facts.js";

/**
 * Pure assembly: ProjectFacts (structural facts, however obtained) -> a
 * schema-valid TemplateManifest. No I/O, no AE connection - this is the
 * deterministic transformation the real INSPECT_TEMPLATE execution would
 * hand its extracted facts to once a bridge/transport exists.
 *
 * Only top-level, non-nested-only compositions become scene candidates,
 * in the exact order ProjectFacts.compositions lists them - never
 * re-sorted (e.g. alphabetically or by duration).
 */
export function buildTemplateManifest(facts: ProjectFacts, now: () => Date = () => new Date()): TemplateManifest {
  const compositions: Composition[] = facts.compositions.map((c) => ({
    compositionId: c.compositionId,
    name: c.name,
    widthPx: c.widthPx,
    heightPx: c.heightPx,
    durationSeconds: c.durationSeconds,
    frameRate: c.frameRate,
    isNestedOnlyReferenced: c.isNestedOnlyReferenced,
    parentCompositionIds: [...c.parentCompositionIds]
  }));

  const unknownItems: TemplateManifest["unknownItems"] = [];

  const scenes: Scene[] = facts.compositions
    .filter((c) => !c.isNestedOnlyReferenced)
    .map((composition, originalOrderIndex) => {
      const placeholders: Placeholder[] = composition.layers.map((layer) => {
        const classification = classifyPlaceholder(layer);
        if (classification.placeholderType === "unknown") {
          unknownItems.push({
            context: `${composition.name} / ${layer.name}`,
            reason: classification.evidence.reason
          });
        }
        return {
          placeholderId: deterministicId([composition.compositionId, ...layer.layerPath, String(layer.index)]),
          displayLabel: null,
          compositionId: composition.compositionId,
          layerName: layer.name,
          layerIndex: layer.index,
          layerPath: [...layer.layerPath],
          placeholderType: classification.placeholderType,
          editable: classification.editable,
          sourceType: layer.layerKind,
          dimensions:
            layer.footage && layer.footage.widthPx !== null && layer.footage.heightPx !== null
              ? { width: layer.footage.widthPx, height: layer.footage.heightPx }
              : null,
          startTimeSeconds: layer.startTimeSeconds,
          durationSeconds: layer.durationSeconds,
          evidence: classification.evidence
        };
      });

      return {
        sceneId: deterministicId([composition.compositionId, String(originalOrderIndex)]),
        displayName: null,
        compositionId: composition.compositionId,
        originalOrderIndex,
        // A scene's timeline placement within a larger sequence is an
        // execution-plan concern (human approval), not an inspection fact -
        // 0 here means "start of this composition's own timeline".
        startTimeSeconds: 0,
        durationSeconds: composition.durationSeconds,
        placeholders
      };
    });

  return {
    schemaVersion: SCHEMA_VERSION,
    templateId: facts.templateId,
    templateName: facts.templateName,
    sourceProject: {
      path: facts.sourceProjectPath,
      name: facts.sourceProjectName,
      sha256: facts.projectSha256
    },
    afterEffects: { version: facts.aeVersion },
    generatedAt: now().toISOString(),
    compositions,
    scenes,
    preflight: {
      requiredFonts: [...facts.requiredFonts],
      footageReferenced: [...facts.footageReferenced],
      missingFootage: facts.missingFootage.map((m) => ({ name: m.name, expectedPath: m.expectedPath })),
      pluginReferences: [...facts.pluginReferences]
    },
    unknownItems
  };
}

/** Pure derived counts for InspectTemplateResponse.summary - every field is a direct count over the manifest, never recomputed differently elsewhere. */
export function computeInspectionSummary(manifest: TemplateManifest): InspectionSummary {
  return {
    compositionCount: manifest.compositions.length,
    candidateSceneCount: manifest.scenes.length,
    editablePlaceholderCount: manifest.scenes.reduce(
      (count, scene) => count + scene.placeholders.filter((p) => p.editable).length,
      0
    ),
    nestedCompositionCount: manifest.compositions.filter((c) => c.isNestedOnlyReferenced).length,
    requiredFontCount: manifest.preflight.requiredFonts.length,
    footageReferencedCount: manifest.preflight.footageReferenced.length,
    missingFootageCount: manifest.preflight.missingFootage.length,
    pluginReferenceCount: manifest.preflight.pluginReferences.length,
    unknownItemCount: manifest.unknownItems.length
  };
}
