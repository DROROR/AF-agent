import { randomUUID } from "node:crypto";
import type { ExecutionPlanEditOperation, NestedTargetStep, PlaceholderMapping, ScenePlanEntry, TemplateManifest } from "@dyo/schemas";
import { computeSceneUnresolvedReasons } from "../../domain/execution-plan/compute-scene-unresolved-reasons.js";
import { ASSET_CLASSIFICATIONS } from "../../domain/execute-frame-dispatch/resolve-execute-frame-dispatch.js";
import { verifyNestedTargetPath } from "../../domain/execution-plan/verify-nested-target-path.js";

function nestedTargetsEqual(a: readonly NestedTargetStep[], b: readonly NestedTargetStep[]): boolean {
  return a.length === b.length && a.every((step, index) => step.compositionId === b[index]?.compositionId && step.layerIndex === b[index]?.layerIndex);
}

export type ApplyEditResult = { ok: true; scenePlans: ScenePlanEntry[] } | { ok: false; reason: string };

function unresolvedReasonsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((reason, index) => reason === b[index]);
}

/**
 * Mapping-review -> execution-plan propagation fix: recomputes the
 * touched scene's `unresolvedReasons` from its real, current mapping
 * state (compute-scene-unresolved-reasons.ts) after EVERY edit
 * operation, rather than leaving the build-time snapshot frozen forever
 * (the exact real bug proven on test22 - 45 scenes stayed "unresolved"
 * no matter how many suggestions were accepted/rejected, because nothing
 * ever recomputed this field). `approvalState` is recomputed alongside
 * it using the SAME live signal, reusing the existing RowApprovalState
 * vocabulary (never a second, invented state system) - but a scene
 * already explicitly APPROVED/REJECTED by a human (APPROVE_SCENE/
 * REJECT_SCENE) is NEVER silently downgraded back to UNREVIEWED by a
 * later content edit; that is still a real, sticky human decision.
 */
function withRecomputedReadiness(scene: ScenePlanEntry): ScenePlanEntry {
  const unresolvedReasons = computeSceneUnresolvedReasons(scene);
  const approvalState =
    scene.approvalState === "APPROVED" || scene.approvalState === "REJECTED"
      ? scene.approvalState
      : unresolvedReasons.length === 0
        ? "READY_FOR_APPROVAL"
        : "UNREVIEWED";
  if (unresolvedReasonsEqual(unresolvedReasons, scene.unresolvedReasons) && approvalState === scene.approvalState) {
    return scene;
  }
  return { ...scene, unresolvedReasons, approvalState };
}

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
 *
 * `currentManifest` is optional - only ADD_MAPPING's own humanNestedTarget
 * validation needs it (verifyNestedTargetPath above), so every OTHER
 * operation/caller stays unaffected. ADD_MAPPING itself fails closed with
 * a clear reason if a nested target is requested but no manifest was
 * supplied, rather than skipping the real-chain verification silently.
 */
function applyExecutionPlanEditRaw(
  scenePlans: readonly ScenePlanEntry[],
  operation: ExecutionPlanEditOperation,
  now: () => Date,
  currentManifest?: TemplateManifest
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

    case "ADD_MAPPING": {
      // Exactly one of humanLayerIndex/humanNestedTarget - see this
      // operation's own schema doc comment for why this lives here rather
      // than a schema-level .refine() (discriminated union constraint).
      const hasDirect = operation.humanLayerIndex !== null && operation.humanLayerIndex !== undefined;
      const hasNested = operation.humanNestedTarget !== null && operation.humanNestedTarget !== undefined;
      if (hasDirect === hasNested) {
        return { ok: false, reason: "ADD_MAPPING requires exactly one of humanLayerIndex or humanNestedTarget - never both, never neither" };
      }

      let humanLayerIndex: number | null = null;
      let humanNestedTarget: NestedTargetStep[] | null = null;
      if (hasDirect) {
        humanLayerIndex = operation.humanLayerIndex as number;
      } else {
        const nestedTarget = operation.humanNestedTarget as NestedTargetStep[];
        if (!currentManifest) {
          return {
            ok: false,
            reason: "ADD_MAPPING with humanNestedTarget requires the current project manifest to verify the real composition chain - none was supplied to this edit"
          };
        }
        const chainError = verifyNestedTargetPath(currentManifest, scene.manifestCompositionId, nestedTarget);
        if (chainError) {
          return { ok: false, reason: chainError };
        }
        humanNestedTarget = nestedTarget;
      }

      // Duplicate real-layer targeting within the SAME scene - direct vs
      // direct, or nested vs nested at the exact same final step - would
      // make two mappings claim the same real AE layer, never silently
      // allowed. A direct target and a nested target can never collide
      // with each other (different compositions by construction: a direct
      // target lives in the owning scene's own composition, a nested
      // target's LAST step is verified above to be a real descendant of
      // it, never that same composition itself).
      const duplicateTarget = scene.mappings.some((m) => {
        if (hasDirect) {
          return m.humanLayerIndex === humanLayerIndex;
        }
        return m.humanNestedTarget !== null && nestedTargetsEqual(m.humanNestedTarget, humanNestedTarget as NestedTargetStep[]);
      });
      if (duplicateTarget) {
        return {
          ok: false,
          reason: `Scene "${scene.id}" already has a mapping targeting this exact real AE layer - a human-added mapping cannot duplicate an existing real target`
        };
      }

      const selectedAssetId = operation.selectedAssetId ?? null;
      const text = operation.text ?? null;
      const isAssetClassification = (ASSET_CLASSIFICATIONS as readonly string[]).includes(operation.placeholderClassification);
      const isTextClassification = operation.placeholderClassification === "text";
      if (isAssetClassification) {
        if (selectedAssetId === null) {
          return { ok: false, reason: `ADD_MAPPING with placeholderClassification "${operation.placeholderClassification}" requires selectedAssetId` };
        }
      } else if (isTextClassification) {
        if (text === null) {
          return { ok: false, reason: `ADD_MAPPING with placeholderClassification "text" requires text` };
        }
      } else {
        return { ok: false, reason: `ADD_MAPPING does not support placeholderClassification "${operation.placeholderClassification}" - only asset types (image/video/logo/phone_screen) or "text" can be human-added today` };
      }
      const newMapping: PlaceholderMapping = {
        id: randomUUID(),
        manifestPlaceholderId: null,
        placeholderName: operation.placeholderName,
        placeholderClassification: { value: operation.placeholderClassification, source: "HUMAN", evidence: [] },
        selectedAssetId: isAssetClassification ? selectedAssetId : null,
        selectedAssetType: isAssetClassification ? operation.placeholderClassification : null,
        text: isTextClassification ? text : null,
        assetTimestamp: null,
        colorHex: null,
        layerVisible: null,
        freezeAtSeconds: null,
        layerDurationSeconds: null,
        humanLayerIndex,
        humanNestedTarget,
        mappingSource: "HUMAN",
        confidence: null,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      return {
        ok: true,
        scenePlans: replaceScene(plans, sceneIndex, { ...scene, mappings: [...scene.mappings, newMapping], updatedAt: timestamp })
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

    case "SET_REELS_LAYOUT":
      return {
        ok: true,
        scenePlans: replaceScene(plans, sceneIndex, {
          ...scene,
          reelsLayout: {
            reelsCompositionName: operation.reelsCompositionName,
            layerTransforms: operation.layerTransforms,
            configuredAt: timestamp
          },
          updatedAt: timestamp
        })
      };

    case "CLEAR_REELS_LAYOUT":
      return { ok: true, scenePlans: replaceScene(plans, sceneIndex, { ...scene, reelsLayout: null, updatedAt: timestamp }) };

    default: {
      const _exhaustive: never = operation;
      throw new Error(`Unhandled execution plan edit operation: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Applies exactly one allowlisted, already-schema-validated edit
 * operation (execution-plan-edit.ts) to a plan's scenePlans - pure, no
 * I/O. Structural validity (unknown composition/placeholder ID, a
 * duplicate finalOrder among included scenes) is checked here; value-
 * level validity (negative duration, invalid timestamp) is already
 * rejected by the request schema before this is ever called - never
 * duplicated here. Wraps applyExecutionPlanEditRaw with a live
 * readiness recomputation for the touched scene (see
 * withRecomputedReadiness above) - the one place every edit path shares,
 * so `unresolvedReasons`/`approvalState` can never again silently drift
 * from the real mapping state that produced them.
 *
 * `currentManifest` (optional) is only consulted by ADD_MAPPING's own
 * humanNestedTarget verification (verifyNestedTargetPath above) - see
 * update-execution-plan.ts for the real production call site, which
 * always supplies the project's current manifest.
 */
export function applyExecutionPlanEdit(
  scenePlans: readonly ScenePlanEntry[],
  operation: ExecutionPlanEditOperation,
  now: () => Date,
  currentManifest?: TemplateManifest
): ApplyEditResult {
  const result = applyExecutionPlanEditRaw(scenePlans, operation, now, currentManifest);
  if (!result.ok) {
    return result;
  }
  const sceneIndex = result.scenePlans.findIndex((s) => s.id === operation.scenePlanId);
  if (sceneIndex === -1) {
    return result;
  }
  const scene = result.scenePlans[sceneIndex] as ScenePlanEntry;
  const recomputed = withRecomputedReadiness(scene);
  if (recomputed === scene) {
    return result;
  }
  return { ok: true, scenePlans: replaceScene(result.scenePlans, sceneIndex, recomputed) };
}
