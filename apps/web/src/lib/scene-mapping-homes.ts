import type { PlaceholderMapping, TemplateManifest } from "@dyo/schemas";
import type { RealScene } from "./real-scene-grouping";

/** One mapping shown on a card, with the scene plan that actually owns it - every edit and suggestion still goes to the owner. */
export interface HostedMapping {
  ownerScenePlanId: string;
  mapping: PlaceholderMapping;
}

export interface SceneMappingHomes {
  /** Card scene plan id -> the mappings shown on that card. */
  mappingsByCardId: Map<string, HostedMapping[]>;
  /** Mapping id -> the card scene plan id it is shown on. */
  cardIdByMappingId: Map<string, string>;
}

/**
 * Decides which CARD each mapping is shown on.
 *
 * Real complaint, 2026-10-02: a template built as one master composition
 * keeps every editable layer under the master's scene plan, so all 28
 * layers and all 28 suggestions piled onto the master's one card - a card
 * many screens tall - while the cards for the master's own parts each said
 * "No content matching required".
 *
 * A mapping whose layer lives inside a nested composition records the exact
 * chain to it (the manifest placeholder's nestedTarget). When the FIRST step
 * of that chain is a composition that has its own card, the mapping is shown
 * on that card: it is the part of the video the layer actually appears in.
 * Anything else stays on its owner's card, exactly as before.
 *
 * Display only. Ownership never changes - a hosted mapping keeps its
 * owner's scene plan id, which is what every edit and suggestion uses.
 */
export function resolveSceneMappingHomes(manifest: TemplateManifest, realScenes: readonly RealScene[]): SceneMappingHomes {
  const placeholderById = new Map(manifest.scenes.flatMap((scene) => scene.placeholders.map((placeholder) => [placeholder.placeholderId, placeholder] as const)));
  const cardIdByCompositionId = new Map(realScenes.map((realScene) => [realScene.manifestCompositionId, realScene.scenePlan.id]));
  const mappingsByCardId = new Map<string, HostedMapping[]>(realScenes.map((realScene) => [realScene.scenePlan.id, []]));
  const cardIdByMappingId = new Map<string, string>();

  for (const realScene of realScenes) {
    for (const mapping of realScene.scenePlan.mappings) {
      const placeholder = mapping.manifestPlaceholderId ? placeholderById.get(mapping.manifestPlaceholderId) : undefined;
      const firstStepCompositionId = placeholder?.nestedTarget?.[0]?.compositionId;
      const hostCardId = firstStepCompositionId !== undefined ? cardIdByCompositionId.get(firstStepCompositionId) : undefined;
      const cardId = hostCardId ?? realScene.scenePlan.id;
      mappingsByCardId.get(cardId)?.push({ ownerScenePlanId: realScene.scenePlan.id, mapping });
      cardIdByMappingId.set(mapping.id, cardId);
    }
  }
  return { mappingsByCardId, cardIdByMappingId };
}
