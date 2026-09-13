import {
  SCHEMA_VERSION,
  type Composition,
  type InspectionSummary,
  type NestedTargetStep,
  type Placeholder,
  type Scene,
  type TemplateManifest
} from "@dyo/schemas";
import { classifyPlaceholder, type Classification } from "./classify-placeholder.js";
import { deterministicId } from "./deterministic-id.js";
import type { CompositionFact, LayerFact, PrecompChildFact, ProjectFacts } from "./project-facts.js";

/**
 * Defensive bound on how many precomp levels below a scene are descended.
 * Matches discover-text-layer-candidates.ts's own default: far beyond any
 * real template (the deepest real chain seen on this project is 5 hops), a
 * guard against a malformed graph rather than a scope limit. Anything beyond
 * it is reported as an unknownItem, never silently dropped.
 */
export const MAX_NESTED_COMPOSITION_DEPTH = 20;

/**
 * Pure assembly: ProjectFacts (structural facts, however obtained) -> a
 * schema-valid TemplateManifest. No I/O, no AE connection - this is the
 * deterministic transformation the real INSPECT_TEMPLATE execution would
 * hand its extracted facts to once a bridge/transport exists.
 *
 * Only top-level, non-nested-only compositions become scene candidates,
 * in the exact order ProjectFacts.compositions lists them - never
 * re-sorted (e.g. alphabetically or by duration).
 *
 * NESTED CONTENT (2026-09-13). A scene's placeholders are its own layers
 * FOLLOWED BY the editable layers found by descending through its precomp
 * references - see collectNestedPlaceholders. Before this, a template whose
 * editable content lives inside precomps produced almost nothing: the real
 * Mixkit "smartphone promo" template (21 compositions, ~96 layers) yielded
 * one placeholder, a CONTROLS solid, because Main_Comp's other five layers
 * are precomp references and nothing below them was ever looked at.
 */
export function buildTemplateManifest(facts: ProjectFacts, now: () => Date = () => new Date()): TemplateManifest {
  const compositions: Composition[] = facts.compositions.map((c) => ({
    compositionId: c.compositionId,
    aeProjectItemIndex: c.aeProjectItemIndex,
    name: c.name,
    widthPx: c.widthPx,
    heightPx: c.heightPx,
    durationSeconds: c.durationSeconds,
    frameRate: c.frameRate,
    isNestedOnlyReferenced: c.isNestedOnlyReferenced,
    parentCompositionIds: [...c.parentCompositionIds]
  }));

  const unknownItems: TemplateManifest["unknownItems"] = [];
  const compositionById = new Map(facts.compositions.map((c) => [c.compositionId, c]));

  const scenes: Scene[] = facts.compositions
    .filter((c) => !c.isNestedOnlyReferenced)
    .map((composition, originalOrderIndex) => {
      // The scene's OWN layers - unchanged behaviour, unchanged IDs, still a
      // prefix of the placeholder list, so nothing that already references a
      // top-level placeholder can shift.
      const placeholders: Placeholder[] = composition.layers.map((layer) => {
        const classification = classifyPlaceholder(layer);
        if (classification.placeholderType === "unknown") {
          unknownItems.push({
            context: `${composition.name} / ${layer.name}`,
            reason: classification.evidence.reason
          });
        }
        return buildPlaceholder({
          placeholderId: deterministicId([composition.compositionId, ...layer.layerPath, String(layer.index)]),
          compositionId: composition.compositionId,
          layer,
          layerPath: [...layer.layerPath],
          nestedTarget: null,
          classification
        });
      });

      placeholders.push(...collectNestedPlaceholders(composition, compositionById, unknownItems));

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

type NestedLayerDecision =
  | { kind: "surface"; classification: Classification }
  | { kind: "structural" }
  | { kind: "uncertain"; reason: string };

/**
 * What to do with ONE layer found inside a nested composition. Stricter than
 * the scene's own top-level layers, deliberately: those were always surfaced
 * and plans may already reference them, whereas nested emission is new and
 * must not flood the manifest with phantom placeholders.
 *
 * Every exclusion is an AE fact, never a name guess:
 *  - `enabled === false`: the layer never renders (a guide/reference layer).
 *  - Shape / camera / light: AE's own type says it is not replaceable media
 *    or text.
 *  - A uniform solid: backgrounds, mattes and adjustment layers inside a
 *    precomp. Also, SET_BRAND_COLOR cannot target a nested layer today, so a
 *    "color" placeholder here would be one the system then refuses to run.
 *
 * Only text, image and video are surfaced - exactly the types that
 * SET_TEXT / MAP_FOOTAGE can actually execute through a nested target.
 * Anything that is neither confidently structural nor confidently one of
 * those becomes an unknownItem: genuine uncertainty is reported, never
 * silently hidden.
 */
function decideNestedLayer(layer: LayerFact): NestedLayerDecision {
  if (layer.enabled === false) {
    return { kind: "structural" };
  }
  if (layer.layerKind === "ShapeLayer" || layer.layerKind === "CameraLayer" || layer.layerKind === "LightLayer") {
    return { kind: "structural" };
  }
  if (layer.solidFill?.isUniformSolidFill) {
    return { kind: "structural" };
  }
  const classification = classifyPlaceholder(layer);
  if (
    classification.placeholderType === "text" ||
    classification.placeholderType === "image" ||
    classification.placeholderType === "video"
  ) {
    return { kind: "surface", classification };
  }
  return {
    kind: "uncertain",
    reason: `nested layer could not be confirmed as either structural or an editable placeholder: ${classification.evidence.reason}`
  };
}

/**
 * Depth-first descent through a scene's precomp references, collecting the
 * editable layers found at any depth.
 *
 * TARGETING (the part that must be exactly right - a wrong chain edits the
 * wrong layer). Each surfaced placeholder carries:
 *  - `compositionId`: the composition that DIRECTLY contains the layer, so
 *    (compositionId, layerIndex) names one real AE layer;
 *  - `nestedTarget`: the chain resolve-execute-frame-dispatch.ts executes,
 *    with the same semantics jsx-templates.ts's wrapNestedScript verifies at
 *    every hop and discover-text-layer-candidates.ts already produces. The
 *    scene's own composition is never a step. For every step but the last,
 *    `layerIndex` is the precomp-reference layer INSIDE that step's
 *    composition that points to the next step; the last step is the layer
 *    itself;
 *  - `layerPath`: the human-readable composition names from the first
 *    nested composition down to the containing one (empty would mean
 *    "directly in the scene", which never applies here).
 *
 * DEDUPLICATION - WITHIN A SCENE. One AE precomp is one shared object:
 * editing a layer inside it changes every place it is used. A composition
 * reached through several parents inside one scene (on the real Mixkit
 * template, `_Place_Image_Above_Mobile` sits under five of them) therefore
 * yields ONE placeholder per underlying layer for that scene, never phantom
 * copies.
 *
 * ACROSS SCENES, EACH SCENE SURFACES ITS OWN PLACEHOLDER (code review
 * findings, 2026-09-13). Two designs were rejected on review:
 *  - per-scene placeholders with no further check let two scenes approve
 *    DIFFERENT text for what is really one layer, and whichever scene ran
 *    last silently overwrote the other in the working copy;
 *  - giving the layer only to the FIRST scene in manifest order starved
 *    every later scene - scene selection is a human decision, so when the
 *    first scene is excluded (or a 9:16 master is chosen over a 16:9 one
 *    built on the same precomps) the chosen scene's visible content had no
 *    placeholder at all.
 * So every scene that reaches a shared layer lists it, and the real hazard -
 * two INCLUDED scenes writing different values to one shared layer - is
 * refused at dispatch by resolve-execute-frame-dispatch.ts, where both
 * scenes' approved values are known.
 *
 * DISABLED PRECOMPS. A precomp-reference layer that is itself switched off
 * never renders, so nothing beneath it is descended into.
 *
 * ORDER AND IDENTITY. Children are visited in AE layer-index order, and a
 * composition's own layers and its precomp references are interleaved by
 * index, so output order follows the AE timeline stack and is identical on
 * every run. IDs hash only structural identity (scene, containing
 * composition, layer index): never a composition or layer NAME, which a
 * rename would change. Including the scene keeps a shared layer's
 * placeholder in two scenes distinct, and independent of scene ORDER.
 */
function collectNestedPlaceholders(
  scene: CompositionFact,
  compositionById: ReadonlyMap<string, CompositionFact>,
  unknownItems: TemplateManifest["unknownItems"]
): Placeholder[] {
  const placeholders: Placeholder[] = [];
  const seenLayers = new Set<string>();
  const walkedCompositions = new Set<string>();
  const reportedGaps = new Set<string>();

  const reportGap = (key: string, context: string, reason: string): void => {
    if (reportedGaps.has(key)) {
      return;
    }
    reportedGaps.add(key);
    unknownItems.push({ context, reason });
  };

  const walk = (
    composition: CompositionFact,
    layerPath: readonly string[],
    chainToParent: readonly NestedTargetStep[],
    onPath: ReadonlySet<string>,
    depth: number
  ): void => {
    const entries = [
      ...composition.layers.map((layer) => ({ index: layer.index, layer, child: null })),
      ...composition.precompChildren.map((child) => ({ index: child.layerIndex, layer: null, child }))
    ].sort((a, b) => a.index - b.index);

    for (const entry of entries) {
      if (entry.child !== null) {
        descend(
          entry.child,
          layerPath,
          [...chainToParent, { compositionId: composition.compositionId, layerIndex: entry.child.layerIndex }],
          onPath,
          depth + 1
        );
        continue;
      }
      const layer = entry.layer as LayerFact;
      const identity = `${composition.compositionId}:${layer.index}`;
      if (seenLayers.has(identity)) {
        continue;
      }
      seenLayers.add(identity);

      const decision = decideNestedLayer(layer);
      if (decision.kind === "structural") {
        continue;
      }
      if (decision.kind === "uncertain") {
        unknownItems.push({ context: [scene.name, ...layerPath, layer.name].join(" / "), reason: decision.reason });
        continue;
      }
      placeholders.push(
        buildPlaceholder({
          placeholderId: deterministicId(["nested", scene.compositionId, composition.compositionId, String(layer.index)]),
          compositionId: composition.compositionId,
          layer,
          layerPath: [...layerPath],
          nestedTarget: [...chainToParent, { compositionId: composition.compositionId, layerIndex: layer.index }],
          classification: decision.classification
        })
      );
    }
  };

  const descend = (
    child: PrecompChildFact,
    parentLayerPath: readonly string[],
    chainForChild: readonly NestedTargetStep[],
    onPath: ReadonlySet<string>,
    depth: number
  ): void => {
    // A switched-off precomp layer never renders: nothing inside it can be a
    // real placeholder. Checked BEFORE marking the child walked, so the same
    // composition reached later through an ENABLED reference is still walked.
    if (child.enabled === false) {
      return;
    }
    const context = [scene.name, ...parentLayerPath, child.layerName].join(" / ");
    const target = compositionById.get(child.sourceCompositionId);
    if (!target) {
      reportGap(
        `not-inspected:${child.sourceCompositionId}`,
        context,
        `precomp layer references composition "${child.sourceCompositionId}", which was not inspected - its content could not be checked for editable layers`
      );
      return;
    }
    if (onPath.has(target.compositionId)) {
      reportGap(
        `cycle:${target.compositionId}`,
        context,
        `composition "${target.name}" is already an ancestor on this nesting path (a cyclic precomp reference) - not descended into again`
      );
      return;
    }
    if (depth > MAX_NESTED_COMPOSITION_DEPTH) {
      reportGap(
        `depth:${target.compositionId}`,
        context,
        `nesting deeper than ${MAX_NESTED_COMPOSITION_DEPTH} composition levels - "${target.name}" and everything below it was not inspected for editable layers`
      );
      return;
    }
    if (walkedCompositions.has(target.compositionId)) {
      // Already walked under another parent in this scene: every layer in it
      // is already recorded (see DEDUPLICATION above).
      return;
    }
    walkedCompositions.add(target.compositionId);
    walk(target, [...parentLayerPath, target.name], chainForChild, new Set([...onPath, target.compositionId]), depth);
  };

  // The scene's own precomp references are the roots of the descent. The
  // scene itself is never a step in any chain, so each starts empty.
  for (const child of [...scene.precompChildren].sort((a, b) => a.layerIndex - b.layerIndex)) {
    descend(child, [], [], new Set([scene.compositionId]), 1);
  }

  return placeholders;
}

function buildPlaceholder(args: {
  placeholderId: string;
  compositionId: string;
  layer: LayerFact;
  layerPath: string[];
  nestedTarget: NestedTargetStep[] | null;
  classification: Classification;
}): Placeholder {
  const { layer, classification } = args;
  return {
    placeholderId: args.placeholderId,
    displayLabel: null,
    compositionId: args.compositionId,
    layerName: layer.name,
    layerIndex: layer.index,
    layerPath: args.layerPath,
    nestedTarget: args.nestedTarget,
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
