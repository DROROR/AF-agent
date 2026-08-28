import type { ExecutionPlanEditOperation, PlaceholderMapping, ScenePlanEntry } from "@dyo/schemas";

export type ApplyEditResult = { ok: true; scenePlans: ScenePlanEntry[] } | { ok: false; reason: string };

/**
 * Normalizes an operator-facing hex color (3 or 6 digits, "#" optional -
 * see execution-plan-edit.ts's own HEX_COLOR_INPUT_PATTERN) to the
 * canonical #RRGGBB uppercase form placeholderMappingSchema requires -
 * the ONLY place this normalization ever happens, so the persisted plan
 * never carries two mappings' worth of the "same" color in different
 * cases/shorthand.
 */
function normalizeColorHex(input: string): string {
  const hex = input.startsWith("#") ? input.slice(1) : input;
  const expanded = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  return `#${expanded.toUpperCase()}`;
}

function replaceScene(scenePlans: ScenePlanEntry[], index: number, updated: ScenePlanEntry): ScenePlanEntry[] {
  const next = [...scenePlans];
  next[index] = updated;
  return next;
}

function updateMapping(
  scene: ScenePlanEntry,
  mappingId: string,
  update: (mapping: PlaceholderMapping) => PlaceholderMapping
): { ok: true; mappings: PlaceholderMapping[] } | { ok: false; reason: string } {
  const index = scene.mappings.findIndex((m) => m.id === mappingId);
  if (index === -1) {
    return { ok: false, reason: `Unknown mappingId "${mappingId}" on scene "${scene.id}"` };
  }
  const mappings = [...scene.mappings];
  mappings[index] = update(mappings[index] as PlaceholderMapping);
  return { ok: true, mappings };
}

/**
 * Applies exactly one allowlisted, already-schema-validated edit
 * operation (execution-plan-edit.ts) to a plan's scenePlans - pure, no
 * I/O. Structural validity (unknown composition/placeholder ID, a
 * duplicate finalOrder among included scenes) is checked here; value-
 * level validity (negative duration, invalid timestamp) is already
 * rejected by the request schema before this is ever called - never
 * duplicated here.
 */
export function applyExecutionPlanEdit(
  scenePlans: readonly ScenePlanEntry[],
  operation: ExecutionPlanEditOperation,
  now: () => Date
): ApplyEditResult {
  const plans = [...scenePlans];
  const sceneIndex = plans.findIndex((s) => s.id === operation.scenePlanId);
  if (sceneIndex === -1) {
    return { ok: false, reason: `Unknown scenePlanId "${operation.scenePlanId}"` };
  }
  const scene = plans[sceneIndex] as ScenePlanEntry;
  const timestamp = now().toISOString();

  switch (operation.type) {
    case "INCLUDE_SCENE":
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, use: true, updatedAt: timestamp }) };

    case "EXCLUDE_SCENE":
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, use: false, updatedAt: timestamp }) };

    case "SET_FINAL_ORDER": {
      // Only meaningful among scenes that actually appear in the output -
      // an excluded scene's own finalOrder value is inert, so duplicating
      // an included scene's order is allowed here (it only matters once/if
      // that scene is later included, at which point this same check runs
      // again via whatever operation flips `use` back on).
      if (scene.use) {
        const duplicate = plans.some(
          (s, i) => i !== sceneIndex && s.use && s.finalOrder === operation.finalOrder
        );
        if (duplicate) {
          return { ok: false, reason: `finalOrder ${operation.finalOrder} is already used by another included scene` };
        }
      }
      return {
        ok: true,
        scenePlans: replaceScene(plans, sceneIndex, { ...scene, finalOrder: operation.finalOrder, updatedAt: timestamp })
      };
    }

    case "MAP_ASSET": {
      const result = updateMapping(scene, operation.mappingId, (m) => ({
        ...m,
        selectedAssetId: operation.selectedAssetId,
        selectedAssetType: operation.selectedAssetType,
        updatedAt: timestamp
      }));
      if (!result.ok) return result;
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, mappings: result.mappings, updatedAt: timestamp }) };
    }

    case "CLEAR_ASSET": {
      const result = updateMapping(scene, operation.mappingId, (m) => ({
        ...m,
        selectedAssetId: null,
        selectedAssetType: null,
        updatedAt: timestamp
      }));
      if (!result.ok) return result;
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, mappings: result.mappings, updatedAt: timestamp }) };
    }

    case "SET_TEXT": {
      const result = updateMapping(scene, operation.mappingId, (m) => ({ ...m, text: operation.text, updatedAt: timestamp }));
      if (!result.ok) return result;
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, mappings: result.mappings, updatedAt: timestamp }) };
    }

    case "CLEAR_TEXT": {
      const result = updateMapping(scene, operation.mappingId, (m) => ({ ...m, text: null, updatedAt: timestamp }));
      if (!result.ok) return result;
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, mappings: result.mappings, updatedAt: timestamp }) };
    }

    case "SET_ASSET_TIMESTAMP": {
      const result = updateMapping(scene, operation.mappingId, (m) => ({
        ...m,
        assetTimestamp: operation.assetTimestamp,
        updatedAt: timestamp
      }));
      if (!result.ok) return result;
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, mappings: result.mappings, updatedAt: timestamp }) };
    }

    case "CLEAR_ASSET_TIMESTAMP": {
      const result = updateMapping(scene, operation.mappingId, (m) => ({ ...m, assetTimestamp: null, updatedAt: timestamp }));
      if (!result.ok) return result;
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, mappings: result.mappings, updatedAt: timestamp }) };
    }

    case "SET_FINAL_DURATION":
      return {
        ok: true,
        scenePlans: replaceScene(plans, sceneIndex, { ...scene, finalDuration: operation.finalDuration, updatedAt: timestamp })
      };

    case "CLEAR_FINAL_DURATION":
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, finalDuration: null, updatedAt: timestamp }) };

    case "SET_BRAND_COLOR": {
      // Only supported target layer/source types allowed (operation-
      // resolution phase, section A) - the same "color" classification
      // gate resolveExecuteFrameDispatch itself checks before ever
      // building a SET_BRAND_COLOR worker operation, enforced here too so
      // an invalid target is refused at EDIT time, not silently accepted
      // and only discovered unresolvable at dispatch time.
      const target = scene.mappings.find((m) => m.id === operation.mappingId);
      if (!target) {
        return { ok: false, reason: `Unknown mappingId "${operation.mappingId}" on scene "${scene.id}"` };
      }
      if (target.placeholderClassification.value !== "color") {
        return {
          ok: false,
          reason: `Mapping "${operation.mappingId}" is not classified as "color" - SET_BRAND_COLOR only applies to color-classified placeholders`
        };
      }
      const result = updateMapping(scene, operation.mappingId, (m) => ({
        ...m,
        colorHex: normalizeColorHex(operation.colorHex),
        updatedAt: timestamp
      }));
      if (!result.ok) return result;
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, mappings: result.mappings, updatedAt: timestamp }) };
    }

    case "CLEAR_BRAND_COLOR": {
      const result = updateMapping(scene, operation.mappingId, (m) => ({ ...m, colorHex: null, updatedAt: timestamp }));
      if (!result.ok) return result;
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, mappings: result.mappings, updatedAt: timestamp }) };
    }

    case "SET_LAYER_VISIBILITY": {
      const target = scene.mappings.find((m) => m.id === operation.mappingId);
      if (!target) {
        return { ok: false, reason: `Unknown mappingId "${operation.mappingId}" on scene "${scene.id}"` };
      }
      if (target.manifestPlaceholderId === null) {
        return {
          ok: false,
          reason: `Mapping "${operation.mappingId}" has no manifestPlaceholderId - it cannot be addressed to any real AE layer, so SET_LAYER_VISIBILITY has no exact canonical layer identity to target`
        };
      }
      const result = updateMapping(scene, operation.mappingId, (m) => ({ ...m, layerVisible: operation.enabled, updatedAt: timestamp }));
      if (!result.ok) return result;
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, mappings: result.mappings, updatedAt: timestamp }) };
    }

    case "CLEAR_LAYER_VISIBILITY": {
      const result = updateMapping(scene, operation.mappingId, (m) => ({ ...m, layerVisible: null, updatedAt: timestamp }));
      if (!result.ok) return result;
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, mappings: result.mappings, updatedAt: timestamp }) };
    }

    case "SET_TIME_REMAP_FREEZE": {
      const target = scene.mappings.find((m) => m.id === operation.mappingId);
      if (!target) {
        return { ok: false, reason: `Unknown mappingId "${operation.mappingId}" on scene "${scene.id}"` };
      }
      if (target.manifestPlaceholderId === null) {
        return {
          ok: false,
          reason: `Mapping "${operation.mappingId}" has no manifestPlaceholderId - it cannot be addressed to any real AE layer, so SET_TIME_REMAP_FREEZE has no exact canonical layer identity to target`
        };
      }
      const result = updateMapping(scene, operation.mappingId, (m) => ({ ...m, freezeAtSeconds: operation.freezeAtSeconds, updatedAt: timestamp }));
      if (!result.ok) return result;
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, mappings: result.mappings, updatedAt: timestamp }) };
    }

    case "CLEAR_TIME_REMAP_FREEZE": {
      const result = updateMapping(scene, operation.mappingId, (m) => ({ ...m, freezeAtSeconds: null, updatedAt: timestamp }));
      if (!result.ok) return result;
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, mappings: result.mappings, updatedAt: timestamp }) };
    }

    case "SET_LAYER_DURATION": {
      const target = scene.mappings.find((m) => m.id === operation.mappingId);
      if (!target) {
        return { ok: false, reason: `Unknown mappingId "${operation.mappingId}" on scene "${scene.id}"` };
      }
      if (target.manifestPlaceholderId === null) {
        return {
          ok: false,
          reason: `Mapping "${operation.mappingId}" has no manifestPlaceholderId - it cannot be addressed to any real AE layer, so SET_LAYER_DURATION has no exact canonical layer identity to target`
        };
      }
      const result = updateMapping(scene, operation.mappingId, (m) => ({
        ...m,
        layerDurationSeconds: operation.layerDurationSeconds,
        updatedAt: timestamp
      }));
      if (!result.ok) return result;
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, mappings: result.mappings, updatedAt: timestamp }) };
    }

    case "CLEAR_LAYER_DURATION": {
      const result = updateMapping(scene, operation.mappingId, (m) => ({ ...m, layerDurationSeconds: null, updatedAt: timestamp }));
      if (!result.ok) return result;
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, mappings: result.mappings, updatedAt: timestamp }) };
    }

    case "SET_INSTRUCTIONS":
      return {
        ok: true,
        scenePlans: replaceScene(plans, sceneIndex, { ...scene, instructions: operation.instructions, updatedAt: timestamp })
      };

    case "CLEAR_INSTRUCTIONS":
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, instructions: null, updatedAt: timestamp }) };

    case "APPROVE_SCENE":
      return {
        ok: true,
        scenePlans: replaceScene(plans, sceneIndex, { ...scene, approvalState: "APPROVED", updatedAt: timestamp })
      };

    case "REJECT_SCENE":
      return {
        ok: true,
        scenePlans: replaceScene(plans, sceneIndex, {
          ...scene,
          approvalState: "REJECTED",
          notes: scene.notes ? `${scene.notes}\n${operation.reason}` : operation.reason,
          updatedAt: timestamp
        })
      };

    default: {
      const _exhaustive: never = operation;
      throw new Error(`Unhandled execution plan edit operation: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
