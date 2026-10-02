import type { TemplateManifest, WorkMapEntry } from "@dyo/schemas";

/**
 * Client-facing UX simplification (Simple Mode "AI Plan"/"Review Plan"
 * step) - the plain-language facts a non-technical client needs to
 * understand what AI found, computed purely from the already-inspected
 * TemplateManifest (never re-inferred, never fabricated). "Main scene"
 * means a real, structurally-confirmed candidate scene
 * (isNestedOnlyReferenced === false) - the exact same fact
 * buildTemplateManifest already used server-side to decide manifest.scenes
 * membership, so this can never disagree with the manifest's own
 * candidateSceneCount.
 */
export interface SimpleAiPlanSummary {
  mainSceneCount: number;
  supportingCompositionCount: number;
  unresolvedItemCount: number;
}

export function computeSimpleAiPlanSummary(manifest: TemplateManifest): SimpleAiPlanSummary {
  return {
    mainSceneCount: manifest.compositions.filter((composition) => !composition.isNestedOnlyReferenced).length,
    supportingCompositionCount: manifest.compositions.filter((composition) => composition.isNestedOnlyReferenced).length,
    unresolvedItemCount: manifest.unknownItems.length
  };
}

/** True once at least one real, editable placeholder was found anywhere in a candidate scene - drives the plain-language "no editable placeholders" notice (never an unexplained "—"). */
export function hasAnyEditablePlaceholder(manifest: TemplateManifest): boolean {
  return manifest.scenes.some((scene) => scene.placeholders.some((placeholder) => placeholder.editable));
}

/**
 * Simple Mode must never surface a raw internal/nested-only AE composition
 * as its own independent client-facing plan item ("CORE SIMPLE MODE RULE" -
 * things like "Phone Screen #13"/"Pre-comp 3" must not appear as
 * independent scenes). Filters using ONLY the manifest's own real
 * isNestedOnlyReferenced fact - never a name guess, never inferred
 * hierarchy. An entry with no sourceCompositionId (free-text client intent
 * not yet tied to any real composition) is always kept, since it cannot be
 * classified as nested-only. Advanced Mode never calls this - it always
 * shows every entry, unfiltered.
 */
export function filterWorkMapEntriesForSimpleMode(entries: WorkMapEntry[], manifest: TemplateManifest): WorkMapEntry[] {
  const nestedOnlyCompositionIds = new Set(
    manifest.compositions.filter((composition) => composition.isNestedOnlyReferenced).map((composition) => composition.compositionId)
  );
  // Was: every nested-only composition hidden, full stop.
  // return entries.filter((entry) => entry.sourceCompositionId === null || !nestedOnlyCompositionIds.has(entry.sourceCompositionId));
  //
  // Real failure, 2026-10-02: a template built as one master composition
  // keeps every scene's text and image inside nested compositions. The AI
  // wrote eleven real rows; this filter showed one card and hid the other
  // ten, including every line of text the client had asked for. A nested
  // composition that DIRECTLY holds a layer the client can change is not
  // plumbing - it is where their content goes - so it is shown. A nested
  // composition holding nothing editable is still hidden, exactly as before.
  const editableCompositionIds = compositionIdsHoldingEditablePlaceholders(manifest);
  return entries.filter(
    (entry) => entry.sourceCompositionId === null || !nestedOnlyCompositionIds.has(entry.sourceCompositionId) || editableCompositionIds.has(entry.sourceCompositionId)
  );
}

/** Every composition that directly holds at least one editable placeholder - a fact read straight from the manifest, never a name guess. */
export function compositionIdsHoldingEditablePlaceholders(manifest: TemplateManifest): Set<string> {
  const ids = new Set<string>();
  for (const scene of manifest.scenes) {
    for (const placeholder of scene.placeholders) {
      if (placeholder.editable) {
        ids.add(placeholder.compositionId);
      }
    }
  }
  return ids;
}

/**
 * True for a real top-level scene (or free-text intent tied to nothing) -
 * false for a nested composition shown only because it holds editable
 * content. Decides the card's title: "Main Scene"/"Scene N" for the former,
 * the composition's own name for the latter, so a nested part is never
 * numbered as though it were an independent scene.
 */
export function isTopLevelPlanEntry(entry: WorkMapEntry, manifest: TemplateManifest): boolean {
  if (entry.sourceCompositionId === null) {
    return true;
  }
  const composition = manifest.compositions.find((candidate) => candidate.compositionId === entry.sourceCompositionId);
  return composition === undefined || !composition.isNestedOnlyReferenced;
}

/**
 * Top-level scenes first in their given order, then the nested parts in
 * natural name order ("Part 2" before "Part 10"). Purely a reading order
 * for the cards - never used to decide what is or is not a scene.
 */
export function orderPlanEntriesForSimpleMode(entries: WorkMapEntry[], manifest: TemplateManifest): WorkMapEntry[] {
  const nameById = new Map(manifest.compositions.map((composition) => [composition.compositionId, composition.name]));
  const nameOf = (entry: WorkMapEntry): string => (entry.sourceCompositionId ? (nameById.get(entry.sourceCompositionId) ?? "") : "");
  const topLevel = entries.filter((entry) => isTopLevelPlanEntry(entry, manifest));
  const nested = entries.filter((entry) => !isTopLevelPlanEntry(entry, manifest));
  nested.sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true, sensitivity: "base" }));
  return [...topLevel, ...nested];
}

/**
 * True once an entry carries real, non-empty AI instruction text worth
 * showing a client as a plain-language scene note (e.g. "AI note: Keep
 * the original template content unchanged..."). Every schema-valid
 * non-null value here is already guaranteed non-empty
 * (workMapEntrySchema's own min(1)); the `.trim()` check is defensive
 * only. Deliberately narrow: `instructions` alone is real client-facing
 * information (real AI-written text a person can read), unlike a raw
 * Work Map UUID/composition ID/desiredAssetId value, which Simple Mode
 * must never expose at all - see PlanCard's own doc comment for where
 * that content actually surfaces instead of the old raw "Advanced
 * details" technical list.
 */
export function hasClientFacingInstructions(entry: WorkMapEntry): boolean {
  return entry.instructions !== null && entry.instructions.trim() !== "";
}

/** One layer the plan changes, with the manifest's own facts about that layer. */
export interface LayerPlanRow {
  entry: WorkMapEntry;
  layerName: string;
  kind: string;
}

/** Every layer row for one composition - one card on screen. */
export interface LayerPlanGroup {
  compositionId: string;
  compositionName: string;
  rows: LayerPlanRow[];
}

/**
 * The rows that name a real layer (targetPlaceholderId), grouped by the
 * composition that layer sits in and put in natural name order - so the
 * client reads "Part 1: headline, subtitle; Part 2: ..." instead of one
 * card per row. A row whose id is not a placeholder of this template is
 * left out here and stays an ordinary scene-level row (see
 * sceneLevelPlanEntries) - never shown as though it reached a layer.
 */
export function groupLayerPlanEntries(entries: WorkMapEntry[], manifest: TemplateManifest): LayerPlanGroup[] {
  const placeholderById = new Map(manifest.scenes.flatMap((scene) => scene.placeholders.map((placeholder) => [placeholder.placeholderId, placeholder] as const)));
  const nameById = new Map(manifest.compositions.map((composition) => [composition.compositionId, composition.name]));
  const groups = new Map<string, LayerPlanGroup>();
  for (const entry of entries) {
    const placeholder = entry.targetPlaceholderId ? placeholderById.get(entry.targetPlaceholderId) : undefined;
    if (!placeholder) {
      continue;
    }
    const group = groups.get(placeholder.compositionId) ?? { compositionId: placeholder.compositionId, compositionName: nameById.get(placeholder.compositionId) ?? placeholder.compositionId, rows: [] };
    group.rows.push({ entry, layerName: placeholder.layerName, kind: placeholder.placeholderType });
    groups.set(placeholder.compositionId, group);
  }
  const natural = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  const ordered = [...groups.values()].sort((a, b) => natural(a.compositionName, b.compositionName));
  for (const group of ordered) {
    group.rows.sort((a, b) => natural(a.layerName, b.layerName));
  }
  return ordered;
}

/** Every row that is NOT shown as a layer row by groupLayerPlanEntries - the scene-level rows, in their given order. */
export function sceneLevelPlanEntries(entries: WorkMapEntry[], manifest: TemplateManifest): WorkMapEntry[] {
  const shownAsLayer = new Set(groupLayerPlanEntries(entries, manifest).flatMap((group) => group.rows.map((row) => row.entry.id)));
  return entries.filter((entry) => !shownAsLayer.has(entry.id));
}
