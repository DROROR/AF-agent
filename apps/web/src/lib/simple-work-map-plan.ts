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
  return entries.filter((entry) => entry.sourceCompositionId === null || !nestedOnlyCompositionIds.has(entry.sourceCompositionId));
}

/**
 * True once an entry carries an actual client-facing content decision -
 * a desired asset, text, instructions, or a real timestamp/duration.
 * Every schema-valid non-null string field here is already guaranteed
 * non-empty (workMapEntrySchema's own min(1)); the `.trim()` checks are
 * defensive only. Drives the Simple Mode "Advanced details" disclosure's
 * own filtering (never a raw technical dump for a composition nobody has
 * decided anything about yet) - Advanced Mode never calls this, it always
 * lists every entry unfiltered.
 */
export function hasMeaningfulWorkMapDetail(entry: WorkMapEntry): boolean {
  return (
    (entry.desiredAssetId !== null && entry.desiredAssetId.trim() !== "") ||
    (entry.desiredText !== null && entry.desiredText.trim() !== "") ||
    (entry.instructions !== null && entry.instructions.trim() !== "") ||
    entry.assetTimestampSeconds !== null ||
    entry.desiredDurationSeconds !== null
  );
}

/** Simple Mode's own filtered view of which entries are worth listing under "Advanced details" - see hasMeaningfulWorkMapDetail. */
export function filterMeaningfulWorkMapEntries(entries: WorkMapEntry[]): WorkMapEntry[] {
  return entries.filter(hasMeaningfulWorkMapDetail);
}
