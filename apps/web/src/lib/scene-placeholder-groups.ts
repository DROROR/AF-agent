/**
 * Groups one scene's placeholder mappings by the composition the layer
 * ACTUALLY lives in, using the manifest's own `layerPath` - nothing is
 * inferred from a layer or composition name.
 *
 * REAL 2026-10-02 DEFECT this exists to end: a single-master template (one
 * top-level composition, every real scene a nested precomp) produced exactly
 * one manifest scene, so `collectNestedPlaceholders` correctly attributed
 * every nested placeholder to that one scene - and the edit drawer then
 * rendered all of them as one undifferentiated list of 30 fieldsets, 23 of
 * them legended "Text A"/"Text B"/"Text C". A reviewer could not tell which
 * text belonged to which scene, which is the one thing they must know before
 * changing it.
 *
 * The grouping information was already in the manifest (`layerPath` is the
 * nesting context by composition, outermost first). This function only reads
 * it, so no worker, manifest or plan behaviour changes: placeholder IDs,
 * mapping IDs and the plan's own scene structure stay exactly as they are.
 *
 * Deliberately NOT sorted by name: order is first appearance in the scene's
 * own mapping list, which is the manifest's own layer order, so the drawer
 * shows scenes in the order the template plays them rather than
 * alphabetically. The scene's own (non-nested) layers always come first -
 * they are the master composition's layers, which is where a template's
 * background and border solids live.
 */

export interface PlaceholderGroupInput {
  mappingId: string;
  /**
   * The manifest `layerPath` of the placeholder this mapping came from:
   * composition names outermost-first, empty when the layer sits directly in
   * the scene's own composition. Null when the mapping has no manifest origin
   * at all (a human-added mapping), which is grouped with the scene's own
   * layers rather than hidden.
   */
  layerPath: readonly string[] | null;
}

export interface PlaceholderGroup {
  /** Stable identity for React keys - the joined path, or "" for the scene's own layers. */
  key: string;
  /** Exactly the manifest's own path, outermost first. Empty = the scene's own layers. */
  layerPath: readonly string[];
  mappingIds: string[];
}

/** The key used for layers that are not inside any nested composition. */
const OWN_LAYERS_KEY = "";

/** A separator that cannot appear in an AE composition name collision-free on its own, so the key is only ever compared, never parsed back. */
const KEY_SEPARATOR = "\u0000";

export function groupMappingsByLayerPath(inputs: readonly PlaceholderGroupInput[]): PlaceholderGroup[] {
  const groups: PlaceholderGroup[] = [];
  const byKey = new Map<string, PlaceholderGroup>();

  for (const input of inputs) {
    const layerPath = input.layerPath ?? [];
    const key = layerPath.length === 0 ? OWN_LAYERS_KEY : layerPath.join(KEY_SEPARATOR);
    const existing = byKey.get(key);
    if (existing) {
      existing.mappingIds.push(input.mappingId);
      continue;
    }
    const group: PlaceholderGroup = { key, layerPath: [...layerPath], mappingIds: [input.mappingId] };
    byKey.set(key, group);
    groups.push(group);
  }

  // The scene's own layers first, every nested group afterwards in first-
  // appearance order. A stable partition, not a sort, so nested order is
  // untouched.
  return [...groups.filter((group) => group.key === OWN_LAYERS_KEY), ...groups.filter((group) => group.key !== OWN_LAYERS_KEY)];
}

/**
 * The heading a reviewer reads for one group. The innermost composition is
 * last in `layerPath`, and that is the one that names the scene, so the whole
 * path is shown (outermost first) to keep a repeated inner name - a template
 * may well have several compositions called "Your_image" - unambiguous.
 */
export function placeholderGroupPathLabel(group: PlaceholderGroup, separator = " › "): string {
  return group.layerPath.join(separator);
}
