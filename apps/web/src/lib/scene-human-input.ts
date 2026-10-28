import type { ScenePlanEntry } from "@dyo/schemas";

/**
 * Whether a person has put anything into this scene: a picture, a text, a
 * colour, or a recorded decision about one of its placeholders.
 *
 * REAL 2026-10-28 (client project 5e27a0e2, "I approve all the scenes and
 * the next button is not live"): a template with 26 top-level compositions
 * listed 26 scenes, the client filled four, and "Approve Scenes" stayed
 * locked because the other 22 - backgrounds, store badges, a QR code, the
 * phone helpers - each still "needed a mapping decision". A scene nobody
 * touched is left exactly as the template has it: there is nothing to
 * execute in it and nothing to decide. Approving excludes it (EXCLUDE_SCENE)
 * instead of asking for 22 cards' worth of decisions.
 */
export function sceneHasHumanInput(scene: ScenePlanEntry): boolean {
  return scene.mappings.some(
    (mapping) =>
      mapping.selectedAssetId !== null ||
      (mapping.text !== null && mapping.text.trim() !== "") ||
      mapping.colorHex !== null ||
      (mapping.keepTemplateText ?? null) !== null ||
      (mapping.slotReview ?? null) !== null ||
      mapping.mappingSource !== "MANIFEST"
  );
}
