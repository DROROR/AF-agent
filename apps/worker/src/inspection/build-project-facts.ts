import type { CompositionFact, LayerFact, ProjectFacts } from "./project-facts.js";
import type { CompositionDetail, CompositionSummary } from "./parse-mcp-shapes.js";

/** Mirrors the scan's own per-layer fact shape - optional/nullable exactly as the scan reports it, so an older worker build's response (no kind/footage at all) still type-checks. */
export interface ScannedLayerFactInput {
  kind?: string | undefined;
  footage?:
    | { hasVideo: boolean; hasAudio: boolean; isStill: boolean; isMissing: boolean; isSolid: boolean; widthPx: number | null; heightPx: number | null }
    | null
    | undefined;
}

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
  /**
   * Real third-party effect matchNames found anywhere in the project, from
   * ONE buildScanProjectEffectsScript call (see
   * parse-project-effects-scan.ts's own doc comment for why this is
   * finally real rather than the empty stub it was for this project's
   * whole prior history). Omitted only when that scan was never attempted
   * or genuinely failed - in which case the caller MUST surface that as an
   * unknownItems entry (heroic-swan-template-inspector.ts does), because
   * an empty list here would otherwise be indistinguishable from a
   * confirmed-plugin-free project, the exact false negative that caused a
   * real misdiagnosis on 2026-09-11.
   */
  pluginReferences?: readonly string[];
  /**
   * Real per-layer type/footage facts from the single project-wide scan,
   * keyed "<compositionId>:<layerIndex>".
   *
   * Before this (2026-09-12) every layer was recorded layerKind "Unknown"
   * with footage null, because ae_get_composition's confirmed shape has no
   * layer-type field - so classify-placeholder.ts, which is perfectly able
   * to assign text/video/image/color, never received anything to classify
   * and EVERY template inspected to editablePlaceholderCount: 0. A layer
   * with no entry here still falls back to "Unknown", never a guess.
   */
  layerFactsByCompositionAndIndex?: ReadonlyMap<string, ScannedLayerFactInput>;
  /** Real text-layer fonts from the same single scan - what the project ASKS FOR, never a claim that each is installed on this machine (AE exposes no such flag). Omitted when the scan failed/was never run. */
  requiredFonts?: readonly string[];
  /** Real resolvable footage paths from the same single scan. Omitted when the scan failed/was never run. */
  footageReferenced?: readonly string[];
  /** Footage AE itself reported as missing (`FootageItem.footageMissing`). Omitted when the scan failed/was never run. */
  missingFootage?: readonly { name: string; expectedPath: string | null }[];
}

/**
 * Turns real parsed MCP facts into the generic ProjectFacts shape
 * build-manifest.ts already knows how to turn into a TemplateManifest.
 *
 * Layer type/footage/fill (2026-09-12): ae_get_composition's confirmed
 * response still reports none of these - only index/name/inPoint/outPoint/
 * nullLayer - so for this project's whole prior history every layer was
 * recorded layerKind "Unknown"/footage null/solidFill null, and
 * classifyPlaceholder() consequently marked EVERY layer unknown. That was
 * honest, but it also meant every template inspected to
 * editablePlaceholderCount: 0 and no mapping table could ever be produced.
 * They are now supplied by `layerFactsByCompositionAndIndex`, from the one
 * project-wide scan that already walks every layer (real
 * `instanceof TextLayer`/`AVLayer`/... checks and real FootageItem fields -
 * see jsx-templates.ts's buildScanProjectPreflightScript). A layer the scan
 * did not cover still falls back to "Unknown" rather than being guessed.
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
      .map((layer): LayerFact => {
        // Real type/footage facts from the single project-wide scan, when
        // available. A layer with no scanned entry still falls back to
        // "Unknown"/null - never a guess.
        const scanned = input.layerFactsByCompositionAndIndex?.get(`${compositionId}:${layer.index}`);
        const scannedKind = scanned?.kind;
        const layerKind: LayerFact["layerKind"] =
          scannedKind === "TextLayer" ||
          scannedKind === "ShapeLayer" ||
          scannedKind === "AVLayer" ||
          scannedKind === "CameraLayer" ||
          scannedKind === "LightLayer"
            ? scannedKind
            : "Unknown";
        const scannedFootage = scanned?.footage ?? null;
        return {
          name: layer.name,
          index: layer.index,
          layerKind,
          // A solid is an AE FootageItem too, but it is a colour placeholder
          // rather than media - reported through solidFill, never as footage,
          // so classify-placeholder.ts reaches its "color" branch.
          footage:
            scannedFootage && !scannedFootage.isSolid
              ? {
                  hasVideo: scannedFootage.hasVideo,
                  hasAudio: scannedFootage.hasAudio,
                  isStill: scannedFootage.isStill,
                  isMissing: scannedFootage.isMissing,
                  widthPx: scannedFootage.widthPx,
                  heightPx: scannedFootage.heightPx
                }
              : null,
          solidFill: scannedFootage?.isSolid ? { isUniformSolidFill: true } : null,
          layerPath: [],
          startTimeSeconds: layer.inPointSeconds,
          durationSeconds: Math.max(0, layer.outPointSeconds - layer.inPointSeconds)
        };
      });

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
    // All four are now REAL whenever the caller performed the project-wide
    // preflight scan (2026-09-11) - previously every one of them was an
    // honest empty stub, because the per-composition round trips the
    // obvious implementation needed carried a real timeout risk. One
    // single-pass ae_run_jsx call now supplies all of them at once. An
    // omitted field still falls back to empty, but the caller is required
    // to surface that as an unknownItems warning rather than let it look
    // like a confirmed-empty result (see this input's own doc comments).
    requiredFonts: input.requiredFonts ? [...input.requiredFonts] : [],
    footageReferenced: input.footageReferenced ? [...input.footageReferenced] : [],
    missingFootage: input.missingFootage ? input.missingFootage.map((item) => ({ ...item })) : [],
    pluginReferences: input.pluginReferences ? [...input.pluginReferences] : []
  };
}
