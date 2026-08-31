import type { PlaceholderMapping, ScenePlanEntry } from "@dyo/schemas";
import { classifyStructuralPlaceholder, resolveKeepOriginal } from "../mapping-suggestion/structural-classification.js";

/**
 * Mapping-review -> execution-plan propagation fix: a real production bug
 * on test22 proved `unresolvedReasons` was populated ONCE at plan-build
 * time from the manifest (build-execution-plan.ts) and then NEVER
 * recomputed as mapping decisions (MAP_ASSET/SET_TEXT/accepted
 * suggestions) were applied - so a scene stayed "unresolved" forever no
 * matter how many of its suggestions were reviewed, permanently blocking
 * plan approval/First Preview. This module is the one authoritative,
 * live readiness computation - reused by every write path (apply-
 * execution-plan-edit.ts) and by the explicit reconciliation path
 * (reconcile-execution-plan-readiness.ts) for an already-stale plan, so
 * there is never a second, competing notion of "is this scene resolved".
 */

/** A mapping has a real, final decision recorded on it - content targets only ever resolve this way. */
export function mappingHasContentDecision(mapping: PlaceholderMapping): boolean {
  return mapping.selectedAssetId !== null || (mapping.text !== null && mapping.text.trim() !== "") || mapping.colorHex !== null;
}

/**
 * A mapping counts as resolved when it has a real decision, OR when it is
 * exempt from ever needing one: a structural/template-helper element
 * (reuses the exact same classifyStructuralPlaceholder the Mapping
 * Assistant's own deterministic matcher uses - a camera/mask/shape-layer/
 * CONTROL layer was never a client content decision to begin with,
 * whether or not a suggestion was ever generated or accepted/rejected
 * for it), or a placeholder the client's own scene instructions
 * explicitly say to leave unchanged (resolveKeepOriginal). A genuine
 * content target (Phone_screen, text, logo, ...) with no decision and no
 * explicit "keep unchanged" instruction is never resolved this way - it
 * genuinely still needs a human content decision.
 */
export function isMappingResolved(mapping: PlaceholderMapping, instructions: string | null): boolean {
  if (mappingHasContentDecision(mapping)) {
    return true;
  }
  const input = {
    placeholderName: mapping.placeholderName,
    currentClassification: mapping.placeholderClassification.value,
    workMapEntry: null,
    userInstructions: instructions
  };
  if (classifyStructuralPlaceholder(input).isStructural) {
    return true;
  }
  return resolveKeepOriginal(input).shouldKeepOriginal;
}

/**
 * The one live readiness computation for a set of mappings (never a
 * second, competing notion) - shared by build-execution-plan.ts (a
 * freshly-built plan must already reflect this correctly, not just a
 * plan that has since been edited) AND computeSceneUnresolvedReasons
 * below (an existing scene being re-evaluated after an edit). Never
 * merely "every placeholder has a confident manifest classification",
 * which is the exact stale/overbroad condition that caused the real
 * test22 bug (most real placeholders are legitimately classification:
 * null/"unknown" forever, regardless of whether a real content decision
 * was made).
 */
export function computeMappingsUnresolvedReasons(mappings: readonly PlaceholderMapping[], instructions: string | null): string[] {
  const unresolvedCount = mappings.filter((mapping) => !isMappingResolved(mapping, instructions)).length;
  if (unresolvedCount === 0) {
    return [];
  }
  return [`${unresolvedCount} placeholder(s) in this scene still need a mapping decision`];
}

/**
 * Live-recomputes a scene's `unresolvedReasons` from its CURRENT mapping
 * state. A composition-level-only scene (zero detected mappings - either
 * nested-only or no placeholder detected at all) has nothing a mapping
 * decision could ever resolve, so its build-time reason is preserved
 * unchanged (a new INSPECT_TEMPLATE/manifest change is the only thing
 * that can ever change this, out of scope here).
 */
export function computeSceneUnresolvedReasons(scene: ScenePlanEntry): string[] {
  if (scene.mappings.length === 0) {
    return [...scene.unresolvedReasons];
  }
  return computeMappingsUnresolvedReasons(scene.mappings, scene.instructions);
}
