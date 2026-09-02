import type { CompositionFact, LayerFact, ProjectFacts } from "./project-facts.js";
import type { CompositionDetail, CompositionSummary } from "./parse-mcp-shapes.js";

export interface BuildProjectFactsInput {
  templateId: string;
  sourceProjectPath: string;
  sourceProjectName: string;
  projectSha256: string;
  aeVersion: string | null;
  /** In ae_list_compositions' own discovery order - never re-sorted. */
  discovered: readonly CompositionSummary[];
  /** Parallel to `discovered`, aligned by array index. `null` where the detail fetch/parse for that composition failed. */
  details: readonly (CompositionDetail | null)[];
  /**
   * Parallel to `discovered`. Each entry lists the (layerIndex,
   * sourceCompositionId) pairs that composition's OWN layers were
   * confirmed (via the real buildInspectCompositionPrecompsScript
   * read-only JSX call - see heroic-swan-template-inspector.ts) to
   * reference as precomp/nested-composition sources - i.e. this
   * composition's real, evidence-based CHILDREN. `null`/omitted where
   * that call failed or was never attempted for this composition - never
   * blocks computing nesting for every OTHER composition that did
   * succeed. Optional so every existing caller/fixture that predates this
   * capability keeps working unchanged (isNestedOnlyReferenced/
   * parentCompositionIds simply stay false/[], and no layer is excluded).
   */
  precompFacts?: readonly (readonly { layerIndex: number; sourceCompositionId: string }[] | null)[];
}

/**
 * Turns real parsed MCP facts into the generic ProjectFacts shape
 * build-manifest.ts already knows how to turn into a TemplateManifest.
 *
 * Known, honest structural limitation (see docs/TEMPLATE-INSPECTOR.md):
 * ae_get_composition's confirmed response never reports a layer's AE type
 * (TextLayer/ShapeLayer/AVLayer/...), footage source, or fill - only
 * index/name/inPoint/outPoint/nullLayer. Every layer here is therefore
 * recorded with layerKind "Unknown", footage null, solidFill null - a
 * real, evidence-backed fact about what current tools CAN confirm
 * (timing, name, index), honestly not claiming what they cannot
 * (classifyPlaceholder() will mark every layer "unknown" until a future
 * pass adds a tool able to confirm real layer type - never invented
 * here).
 *
 * Nesting (isNestedOnlyReferenced/parentCompositionIds) IS now real,
 * evidence-based data when `precompFacts` is provided (client-facing UX
 * redesign, "LIVE UX ACCEPTANCE FAILED" follow-up) - computed purely from
 * confirmed `layer.source instanceof CompItem` facts, never guessed from
 * naming conventions (e.g. "Scene_01_comp" looking like a precomp of
 * "Scene_01" is exactly the kind of invented semantic label this
 * project's instructions forbid - see buildInspectCompositionPrecompsScript's
 * own doc comment for the real API this relies on instead). When
 * `precompFacts` is omitted (a caller/fixture that predates this
 * capability, or every precomp call genuinely failed), every composition
 * still honestly defaults to false/[] rather than a guess.
 */
export function buildProjectFacts(input: BuildProjectFactsInput): ProjectFacts {
  const compositions: CompositionFact[] = input.discovered.map((summary, i) => {
    const detail = input.details[i] ?? null;
    // AE's own persistent comp.id survives reordering and is preferred when
    // available; the project-item index is still guaranteed unique per
    // project, so it remains a safe fallback when the detail call failed.
    const compositionId = detail?.compId != null ? `comp-${detail.compId}` : `idx-${summary.index}`;

    // Real, evidence-based layer indices THIS composition's own
    // precomps-script call confirmed are precomp/nested-composition
    // references - excluded below alongside nullLayer, since a precomp
    // reference is structural (it wraps other content), never itself an
    // editable placeholder candidate.
    const precompLayerIndices = new Set((input.precompFacts?.[i] ?? []).map((entry) => entry.layerIndex));

    const layers: LayerFact[] = (detail?.layers ?? [])
      // "Whether a layer is a null object (excluded from placeholder
      // candidates)" - see allowed-inspection-queries.ts's layer.nullLayer entry.
      .filter((layer) => !layer.nullLayer && !precompLayerIndices.has(layer.index))
      .map(
        (layer): LayerFact => ({
          name: layer.name,
          index: layer.index,
          layerKind: "Unknown",
          footage: null,
          solidFill: null,
          layerPath: [],
          startTimeSeconds: layer.inPointSeconds,
          durationSeconds: Math.max(0, layer.outPointSeconds - layer.inPointSeconds)
        })
      );

    return {
      compositionId,
      aeProjectItemIndex: summary.index,
      name: summary.name,
      widthPx: detail?.widthPx ?? summary.widthPx,
      heightPx: detail?.heightPx ?? summary.heightPx,
      durationSeconds: detail?.durationSeconds ?? summary.durationSeconds,
      frameRate: detail?.frameRate ?? summary.frameRate,
      isNestedOnlyReferenced: false,
      parentCompositionIds: [],
      layers
    };
  });

  // Second pass: a composition earns a real parent entry whenever ANOTHER
  // composition's own confirmed precompLayers point at it - this can only
  // be computed once every composition's own id (first pass, above) is
  // known, since precompFacts[i] names CHILDREN by id, not by index.
  const parentsByChildId = new Map<string, Set<string>>();
  input.discovered.forEach((_summary, i) => {
    const parentCompositionId = compositions[i]!.compositionId;
    const precompEntries = input.precompFacts?.[i];
    if (!precompEntries) {
      return;
    }
    for (const entry of precompEntries) {
      const parents = parentsByChildId.get(entry.sourceCompositionId) ?? new Set<string>();
      parents.add(parentCompositionId);
      parentsByChildId.set(entry.sourceCompositionId, parents);
    }
  });

  const compositionsWithNesting: CompositionFact[] = compositions.map((composition) => {
    const parents = parentsByChildId.get(composition.compositionId);
    if (!parents || parents.size === 0) {
      return composition;
    }
    return { ...composition, isNestedOnlyReferenced: true, parentCompositionIds: [...parents] };
  });

  return {
    // No separate human-supplied template name exists in InspectTemplateRequest
    // yet - reusing templateId is honest reuse of given input, not an
    // invented label.
    templateId: input.templateId,
    templateName: input.templateId,
    aeVersion: input.aeVersion,
    sourceProjectPath: input.sourceProjectPath,
    sourceProjectName: input.sourceProjectName,
    projectSha256: input.projectSha256,
    compositions: compositionsWithNesting,
    // Not determinable from the currently allowlisted read-only tools'
    // confirmed shapes (fonts require TextLayer.sourceText, footage
    // references require FootageItem fields, plugins require layer effect
    // enumeration - none of which ae_get_composition's confirmed shape
    // exposes). Left honestly empty rather than guessed; build-manifest.ts's
    // own unknownItems (one per "unknown" placeholder) already surfaces
    // this gap per-layer.
    requiredFonts: [],
    footageReferenced: [],
    missingFootage: [],
    pluginReferences: []
  };
}
