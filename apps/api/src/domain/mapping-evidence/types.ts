import type { PlaceholderType, ProjectBrandInputs, SceneEvidenceResponse, WorkMapEntry } from "@dyo/schemas";
import type { AssetRecord } from "../asset/types.js";

/**
 * The strict evidence bundle for one unresolved mapping candidate
 * (mapping-assistant phase section 2). Purely an internal, API-side
 * computation - never serialized over HTTP directly (a suggestion's own
 * `evidenceRefs` is the cross-boundary, provenance-tagged summary of what
 * a bundle contained - see mapping-suggestion.ts in @dyo/schemas), so this
 * stays a plain domain type here rather than a second schema in
 * @dyo/schemas. Built once per candidate by build-evidence-bundles.ts from
 * real, already-loaded state - it is never fetched or re-derived
 * mid-match, and never contains a value invented rather than sourced from
 * one of its own fields below.
 */
export interface MappingEvidenceBundle {
  scenePlanId: string;
  manifestCompositionId: string;
  compositionName: string;
  sourcePosition: number;
  /** Null when the scene has no detected placeholder mapping at all (composition-level-only unresolved scene). */
  mappingId: string | null;
  manifestPlaceholderId: string | null;
  placeholderName: string | null;
  /** The manifest/current mapping's own classification if one is already known - never re-guessed here, only carried forward. */
  currentClassification: PlaceholderType | null;
  /** Null until a durable scene-evidence store exists (Phase 7B's INSPECT_SCENE_EVIDENCE result is not yet persisted anywhere - see this phase's own audit) - the matcher/provider must treat this as "not available", never as "confirmed absent". */
  sceneEvidence: SceneEvidenceResponse | null;
  /** The Work Map entry for this same scene, if the client described one (matched by sourceCompositionId) - USER_INTENT, outranks inference (section 11). */
  workMapEntry: WorkMapEntry | null;
  /** Every real, non-deleted asset in this exact project - the ONLY pool a suggestion's assetId may ever be drawn from. */
  candidateAssets: AssetRecord[];
  /** The scene's own stored instructions/notes, if any - real, human-authored USER_INTENT. */
  userInstructions: string | null;
  /** This project's brand inputs, if any are set. */
  brandInputs: ProjectBrandInputs | null;
}
