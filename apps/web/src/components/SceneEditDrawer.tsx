"use client";

import { useWorkspaceModeIfPresent } from "./WorkspaceModeProvider";
import { useEffect, useState, type ReactElement } from "react";
import {
  assessMappingSlot,
  assessTemplateCopy,
  slotEvidenceDigest,
  sha256Hex,
  type ExecutionPlanEditOperation,
  type MediaKind,
  type PlaceholderType,
  type TemplateCopyAssessment,
  type TemplateTextDecision,
  type TextCaptureStatus,
  type TextVerification,
  type PlaceholderMapping,
  type SlotAssessment
} from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useProjectAssets } from "../lib/use-project-assets";
import { Dialog } from "./ui/Dialog";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Button } from "./ui/Button";
import { ErrorState } from "./ErrorState";
import { EmptyState } from "./EmptyState";
import { useLocale } from "./LocaleProvider";
import { SlotReviewPanel, type SlotReviewChoice } from "./SlotReviewPanel";
import { fieldsForLayerKind, type MappingFieldVisibility } from "../lib/mapping-field-visibility";
import { groupMappingsByLayerPath, placeholderGroupPathLabel } from "../lib/scene-placeholder-groups";

/** Every real asset kind maps to the closest real placeholderType MAP_ASSET requires; a non-visual kind (AUDIO/DOCUMENT/OTHER) is honestly "unknown" rather than a fabricated visual type. */
function placeholderTypeForMediaKind(mediaKind: MediaKind): PlaceholderType {
  switch (mediaKind) {
    case "IMAGE":
      return "image";
    case "VIDEO":
      return "video";
    case "LOGO":
      return "logo";
    default:
      return "unknown";
  }
}

export interface SceneEditDrawerProps {
  scenePlanId: string | null;
  onClose: () => void;
  /**
   * Narrows the drawer to these mappings of the scene - used when a card
   * shows only some of a scene's layers (see resolveSceneMappingHomes).
   * Null/absent: every mapping of the scene, exactly as before.
   */
  onlyMappingIds?: readonly string[] | null;
  /** Open on this layer's own box (scrolled to and focused). Null/absent: the top of the panel, as before. */
  focusMappingId?: string | null;
}

interface MappingFormState {
  mappingId: string;
  label: string;
  text: string;
  assetTimestamp: string;
  selectedAssetId: string;
  /** How the picture is turned on its place - both "off" means exactly as the template holds it. */
  mirror: boolean;
  quarterTurns: 0 | 1 | 2 | 3;
  /**
   * The colour typed/picked in THIS form session - "" means "no explicit
   * colour", which leaves the template's own colour untouched. Only ever
   * rendered for a mapping the manifest classified "color"; sent as
   * SET_BRAND_COLOR, which normalizes it to canonical #RRGGBB server-side.
   */
  colorHex: string;
  /** The reviewer's explicit choice in THIS form session, or null while undecided - never defaulted, since a default would be a decision nobody made. */
  templateTextDecision: TemplateTextDecision | null;
  /** The reviewer's explicit SLOT decision in this form session (Stage 4), or null while undecided - same rule. */
  slotDecision: SlotReviewChoice | null;
  /** The evidence frame the panel is currently showing, which is the only frame a slot decision may be recorded against. */
  slotEvidenceFrameStorageKey: string | null;
}

/**
 * Whether the template-copy decision currently shown for a mapping is the one
 * the PLAN already holds - which is exactly the condition buildOperations()
 * below uses to decide whether that decision still has to be SENT. A decision
 * whose text has since been edited counts as unsaved too: saving re-records it
 * against the new text, so what the plan holds is a decision about different
 * wording.
 */
function isTemplateDecisionPersisted(form: MappingFormState, mapping: PlaceholderMapping): boolean {
  const persisted = mapping.keepTemplateText?.decision ?? null;
  if (form.templateTextDecision === null || form.templateTextDecision !== persisted) {
    return false;
  }
  const trimmed = form.text.trim();
  return (trimmed === "" ? null : trimmed) === mapping.text;
}

/**
 * Whether the colour shown in the form differs from the one the plan holds.
 * Case-INSENSITIVE on purpose: the plan stores the canonical uppercase
 * #RRGGBB that apply-execution-plan-edit.ts normalizes to, while a native
 * colour input reports lowercase. A byte comparison would therefore report a
 * change on a colour nobody touched, and every save would emit a no-op
 * SET_BRAND_COLOR for every colour mapping in the scene.
 */
/** True when the form's flip/turn differs from what the plan holds - an absent record and "no flip, no turn" are the same thing. */
export function isOrientationChanged(
  form: { mirror: boolean; quarterTurns: 0 | 1 | 2 | 3 },
  persisted: { assetOrientation?: { mirror: boolean; quarterTurns: 0 | 1 | 2 | 3 } | null | undefined }
): boolean {
  return form.mirror !== (persisted.assetOrientation?.mirror ?? false) || form.quarterTurns !== (persisted.assetOrientation?.quarterTurns ?? 0);
}

export function isBrandColorChanged(formColorHex: string, persistedColorHex: string | null): boolean {
  const trimmed = formColorHex.trim();
  const next = trimmed === "" ? null : trimmed;
  if (next === null) {
    return persistedColorHex !== null;
  }
  if (persistedColorHex === null) {
    return true;
  }
  return next.toUpperCase() !== persistedColorHex.toUpperCase();
}

/**
 * Whether the slot decision currently shown for a mapping is the one the PLAN
 * already holds. Deliberately NOT "buildOperations would emit nothing": that
 * emits SET_SLOT_REVIEW for every non-null choice, including an unchanged one,
 * so it can never distinguish a recorded decision from a clicked one - the
 * exact confusion this predicate exists to end (real 2026-09-24 end-to-end
 * run: three decisions read as "Recorded" and all three were still
 * `slotReview: null` in the database afterwards).
 */
function isSlotDecisionPersisted(form: MappingFormState, mapping: PlaceholderMapping): boolean {
  const persisted = mapping.slotReview ?? null;
  if (form.slotDecision === null || persisted == null) {
    return false;
  }
  if (form.slotDecision.kind === "ACCEPT") {
    return persisted.decision === "ACCEPT";
  }
  return persisted.decision === "OVERRIDE_CLASSIFICATION" && persisted.classification === form.slotDecision.classification;
}

/**
 * Edits exactly the fields Phase 6's edit contract supports (section 9 of
 * the dashboard-integration task): scene-level finalDuration/instructions,
 * and per-mapping text/assetTimestamp/asset. The asset picker offers only
 * this exact project's real Asset Catalog (useProjectAssets), never an
 * arbitrary/cross-project id - "Unmapped" (empty selection) stays a valid
 * choice, never forced to pick something. Submits every changed field as
 * one batched PATCH (one revision bump), diffed against the scene's
 * current real values - an untouched field is never resent/cleared.
 */
export function SceneEditDrawer({ scenePlanId, onClose, onlyMappingIds, focusMappingId }: SceneEditDrawerProps): ReactElement | null {
  const { t } = useLocale();
  const isSimple = useWorkspaceModeIfPresent() === "simple";
  const { project, plan, applyEdit } = useProjectWorkspaceContext();
  const { assets } = useProjectAssets(project?.project.projectId ?? "");
  const [finalDuration, setFinalDuration] = useState("");
  const [instructions, setInstructions] = useState("");
  const [mappings, setMappings] = useState<MappingFormState[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);

  const scene = plan?.plan.scenePlans.find((candidate) => candidate.id === scenePlanId) ?? null;

  // A card's "write my own text" opens the panel ON that text's box - the
  // client is not left to work out which of several boxes was meant.
  const hasFormForFocus = focusMappingId != null && mappings.some((m) => m.mappingId === focusMappingId);
  useEffect(() => {
    if (!hasFormForFocus) {
      return;
    }
    const input = document.getElementById(`mapping-text-${focusMappingId}`);
    if (input instanceof HTMLElement) {
      input.scrollIntoView?.({ block: "center" });
      input.focus();
    }
  }, [hasFormForFocus, focusMappingId, scenePlanId]);

  useEffect(() => {
    if (!scene) {
      return;
    }
    // Synchronizes local editable form state from the real scene whenever
    // the drawer opens for a (possibly different) scene, or the
    // underlying plan changes - a standard "derive editable state from an
    // external value" effect, not an async fetch, so it's exempt from the
    // async-cascading-render concern react-hooks/set-state-in-effect
    // otherwise guards against (same precedent as AppShell.tsx).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFinalDuration(scene.finalDuration !== null ? String(scene.finalDuration) : "");
    setInstructions(scene.instructions ?? "");
    setMappings(
      // scene.mappings.map((mapping) => ({
      scene.mappings.filter((mapping) => onlyMappingIds == null || onlyMappingIds.includes(mapping.id)).map((mapping) => ({
        mappingId: mapping.id,
        label: mapping.placeholderName ?? mapping.id,
        text: mapping.text ?? "",
        assetTimestamp: mapping.assetTimestamp !== null ? String(mapping.assetTimestamp) : "",
        selectedAssetId: mapping.selectedAssetId ?? "",
        mirror: mapping.assetOrientation?.mirror ?? false,
        quarterTurns: mapping.assetOrientation?.quarterTurns ?? 0,
        colorHex: mapping.colorHex ?? "",
        templateTextDecision: mapping.keepTemplateText?.decision ?? null,
        slotDecision:
          mapping.slotReview == null
            ? null
            : mapping.slotReview.decision === "ACCEPT"
              ? { kind: "ACCEPT" }
              : mapping.slotReview.classification === null
                ? null
                : { kind: "OVERRIDE", classification: mapping.slotReview.classification },
        slotEvidenceFrameStorageKey: mapping.slotReview?.evidenceFrameStorageKey ?? null
      }))
    );
    setError(null);
    setIsConfirmingDiscard(false);
  }, [scene, onlyMappingIds]);

  if (!scenePlanId || !scene) {
    return null;
  }

  /**
   * What the project's CURRENT manifest knows about a mapping's own template
   * wording: the complete text when it is stored, a display-only excerpt plus
   * verification digests when the text was too long to store, and neither
   * when this manifest predates template-text capture (which the shared gate
   * reports as blocking - the dashboard never invents a value to make the
   * warning go away).
   */
  function templateTextFor(mappingId: string): {
    text: string | null | undefined;
    preview: string | null;
    truncated: boolean;
    verification: TextVerification | null;
    captureStatus: TextCaptureStatus | null;
    codeUnitLength: number | null;
  } {
    const none = { text: null, preview: null, truncated: false, verification: null, captureStatus: null, codeUnitLength: null };
    const mapping = scene!.mappings.find((candidate) => candidate.id === mappingId);
    if (!mapping || mapping.manifestPlaceholderId === null) {
      return none;
    }
    for (const manifestScene of project?.manifest.scenes ?? []) {
      for (const placeholder of manifestScene.placeholders) {
        if (placeholder.placeholderId === mapping.manifestPlaceholderId) {
          const truncated = placeholder.originalTextTruncated === true;
          return {
            text: truncated ? undefined : placeholder.originalText,
            preview: truncated ? (placeholder.originalTextPreview ?? null) : null,
            truncated,
            verification: placeholder.originalTextVerification ?? null,
            captureStatus: placeholder.originalTextCaptureStatus ?? null,
            codeUnitLength:
              placeholder.originalTextCodeUnitLength ?? placeholder.originalTextVerification?.codeUnitLength ?? null
          };
        }
      }
    }
    return { ...none, text: undefined };
  }

  /**
   * The manifest placeholder a mapping came from, or null when it has no
   * manifest origin. Same walk as templateTextFor above, for the same
   * reason: the manifest is the only place that records WHICH composition a
   * nested layer actually lives in (`layerPath`), and the plan's own mapping
   * deliberately does not duplicate that.
   */
  function manifestLayerPathFor(mappingId: string): readonly string[] | null {
    const mapping = scene!.mappings.find((candidate) => candidate.id === mappingId);
    if (!mapping || mapping.manifestPlaceholderId === null) {
      return null;
    }
    for (const manifestScene of project?.manifest.scenes ?? []) {
      for (const placeholder of manifestScene.placeholders) {
        if (placeholder.placeholderId === mapping.manifestPlaceholderId) {
          return placeholder.layerPath;
        }
      }
    }
    return null;
  }

  /** When a layer is on screen, from the template reading - null when it was not recorded. */
  function manifestTimingFor(mappingId: string): { startSeconds: number; durationSeconds: number } | null {
    const mapping = scene!.mappings.find((candidate) => candidate.id === mappingId);
    if (!mapping || mapping.manifestPlaceholderId === null) {
      return null;
    }
    for (const manifestScene of project?.manifest.scenes ?? []) {
      for (const placeholder of manifestScene.placeholders) {
        if (placeholder.placeholderId === mapping.manifestPlaceholderId) {
          return typeof placeholder.startTimeSeconds === "number" && typeof placeholder.durationSeconds === "number"
            ? { startSeconds: placeholder.startTimeSeconds, durationSeconds: placeholder.durationSeconds }
            : null;
        }
      }
    }
    return null;
  }
  const videoSeconds = Math.max(0, ...(project?.manifest.compositions ?? []).filter((composition) => !composition.isNestedOnlyReferenced).map((composition) => composition.durationSeconds));

  /** The template's own colour for a Color Control placeholder - null for any other layer, and when inspection could not read it. Its presence is also what says a NESTED colour can be set (SET_COLOR_CONTROL reaches nested layers; a solid's fill cannot). */
  function colorControlFor(mappingId: string): { currentColorHex: string | null } | null {
    const mapping = scene!.mappings.find((candidate) => candidate.id === mappingId);
    if (!mapping || mapping.manifestPlaceholderId === null) {
      return null;
    }
    for (const manifestScene of project?.manifest.scenes ?? []) {
      for (const placeholder of manifestScene.placeholders) {
        if (placeholder.placeholderId === mapping.manifestPlaceholderId) {
          return placeholder.colorControl ? { currentColorHex: placeholder.colorControl.currentColorHex } : null;
        }
      }
    }
    return null;
  }

  /**
   * The manifest's own classification value for this mapping. "color" is the
   * only value for which a colour field may be offered at all - the same gate
   * resolveExecuteFrameDispatch applies before it will run SET_BRAND_COLOR.
   */
  function classificationFor(mappingId: string): string | null {
    return scene!.mappings.find((candidate) => candidate.id === mappingId)?.placeholderClassification.value ?? null;
  }

  /** What this layer's section offers - decided by the layer's own kind, see mapping-field-visibility.ts. */
  function fieldsFor(mappingId: string): MappingFieldVisibility {
    const original = scene!.mappings.find((candidate) => candidate.id === mappingId);
    return fieldsForLayerKind(classificationFor(mappingId), {
      hasAsset: (original?.selectedAssetId ?? null) !== null,
      hasText: (original?.text ?? "") !== "",
      hasTimestamp: (original?.assetTimestamp ?? null) !== null
    });
  }

  /** Assessed with the SAME pure function the backend gate uses, against the text currently typed in the form - so the warning tracks what the reviewer is actually about to save. */
  function assessMapping(form: MappingFormState): TemplateCopyAssessment {
    const original = scene!.mappings.find((candidate) => candidate.id === form.mappingId);
    const trimmed = form.text.trim();
    const typedText = trimmed === "" ? null : trimmed;
    const template = templateTextFor(form.mappingId);
    return assessTemplateCopy({
      mappingText: typedText,
      templateText: template.text,
      templateTextVerification: template.verification,
      templateTextCaptureStatus: template.captureStatus,
      decision:
        form.templateTextDecision === null
          ? null
          : {
              decision: form.templateTextDecision,
              decidedBy: original?.keepTemplateText?.decidedBy ?? "pending",
              decidedAt: original?.keepTemplateText?.decidedAt ?? new Date(0).toISOString(),
              // A choice made in this form session is about the text in this
              // form session - saving records exactly that, and binds it to
              // that text's own complete digest.
              textAtDecision: typedText ?? "",
              textDigestAtDecision: sha256Hex(typedText ?? "")
            }
    });
  }

  function buildOperations(): ExecutionPlanEditOperation[] {
    const ops: ExecutionPlanEditOperation[] = [];
    const currentScene = scene!;

    const trimmedDuration = finalDuration.trim();
    const nextDuration = trimmedDuration === "" ? null : Number(trimmedDuration);
    if (nextDuration !== currentScene.finalDuration) {
      if (nextDuration === null) {
        ops.push({ type: "CLEAR_FINAL_DURATION", scenePlanId: currentScene.id });
      } else if (Number.isFinite(nextDuration) && nextDuration > 0) {
        ops.push({ type: "SET_FINAL_DURATION", scenePlanId: currentScene.id, finalDuration: nextDuration });
      }
    }

    const trimmedInstructions = instructions.trim();
    const nextInstructions = trimmedInstructions === "" ? null : trimmedInstructions;
    if (nextInstructions !== currentScene.instructions) {
      if (nextInstructions === null) {
        ops.push({ type: "CLEAR_INSTRUCTIONS", scenePlanId: currentScene.id });
      } else {
        ops.push({ type: "SET_INSTRUCTIONS", scenePlanId: currentScene.id, instructions: nextInstructions });
      }
    }

    for (const form of mappings) {
      const originalMapping = currentScene.mappings.find((m) => m.id === form.mappingId);
      if (!originalMapping) {
        continue;
      }
      const trimmedText = form.text.trim();
      const nextText = trimmedText === "" ? null : trimmedText;
      if (nextText !== originalMapping.text) {
        if (nextText === null) {
          ops.push({ type: "CLEAR_TEXT", scenePlanId: currentScene.id, mappingId: form.mappingId });
        } else {
          ops.push({ type: "SET_TEXT", scenePlanId: currentScene.id, mappingId: form.mappingId, text: nextText });
        }
      }

      // Only ever emitted for a mapping the MANIFEST itself classified
      // "color" - the same gate resolveExecuteFrameDispatch applies before it
      // will run SET_BRAND_COLOR, so the UI can never queue an edit the
      // executor then refuses.
      if (classificationFor(form.mappingId) === "color" && isBrandColorChanged(form.colorHex, originalMapping.colorHex)) {
        const nextColor = form.colorHex.trim();
        if (nextColor === "") {
          ops.push({ type: "CLEAR_BRAND_COLOR", scenePlanId: currentScene.id, mappingId: form.mappingId });
        } else {
          ops.push({ type: "SET_BRAND_COLOR", scenePlanId: currentScene.id, mappingId: form.mappingId, colorHex: nextColor });
        }
      }

      const trimmedTimestamp = form.assetTimestamp.trim();
      const nextTimestamp = trimmedTimestamp === "" ? null : Number(trimmedTimestamp);
      if (nextTimestamp !== originalMapping.assetTimestamp) {
        if (nextTimestamp === null) {
          ops.push({ type: "CLEAR_ASSET_TIMESTAMP", scenePlanId: currentScene.id, mappingId: form.mappingId });
        } else if (Number.isFinite(nextTimestamp) && nextTimestamp >= 0) {
          ops.push({ type: "SET_ASSET_TIMESTAMP", scenePlanId: currentScene.id, mappingId: form.mappingId, assetTimestamp: nextTimestamp });
        }
      }

      // Emitted AFTER any SET_TEXT/CLEAR_TEXT above, so the decision the API
      // records carries the text the reviewer actually decided about - a
      // decision saved against the previous text would immediately be stale.
      const previousDecision = originalMapping.keepTemplateText?.decision ?? null;
      const textChanged = nextText !== originalMapping.text;
      if (form.templateTextDecision === null) {
        if (previousDecision !== null) {
          ops.push({ type: "CLEAR_TEMPLATE_TEXT_DECISION", scenePlanId: currentScene.id, mappingId: form.mappingId });
        }
      } else if (form.templateTextDecision !== previousDecision || textChanged) {
        ops.push({
          type: "SET_TEMPLATE_TEXT_DECISION",
          scenePlanId: currentScene.id,
          mappingId: form.mappingId,
          decision: form.templateTextDecision
        });
      }

      const nextAssetId = form.selectedAssetId === "" ? null : form.selectedAssetId;
      if (nextAssetId !== originalMapping.selectedAssetId) {
        if (nextAssetId === null) {
          ops.push({ type: "CLEAR_ASSET", scenePlanId: currentScene.id, mappingId: form.mappingId });
        } else {
          const selectedAsset = (assets ?? []).find((asset) => asset.id === nextAssetId);
          if (selectedAsset) {
            ops.push({
              type: "MAP_ASSET",
              scenePlanId: currentScene.id,
              mappingId: form.mappingId,
              selectedAssetId: nextAssetId,
              selectedAssetType: placeholderTypeForMediaKind(selectedAsset.mediaKind)
            });
          }
        }
      }

      if (isOrientationChanged(form, originalMapping)) {
        if (!form.mirror && form.quarterTurns === 0) {
          ops.push({ type: "CLEAR_ASSET_ORIENTATION", scenePlanId: currentScene.id, mappingId: form.mappingId });
        } else {
          ops.push({
            type: "SET_ASSET_ORIENTATION",
            scenePlanId: currentScene.id,
            mappingId: form.mappingId,
            orientation: { mirror: form.mirror, quarterTurns: form.quarterTurns }
          });
        }
      }

      // STAGE 4 - emitted LAST for this mapping, after any asset change above,
      // so the findings the API binds the decision to are the ones this same
      // request produces. A decision saved against the previous asset would be
      // stale the moment it landed.
      const previousSlotDecision = originalMapping.slotReview ?? null;
      if (form.slotDecision === null) {
        if (previousSlotDecision !== null) {
          ops.push({ type: "CLEAR_SLOT_REVIEW", scenePlanId: currentScene.id, mappingId: form.mappingId });
        }
      } else {
        ops.push({
          type: "SET_SLOT_REVIEW",
          scenePlanId: currentScene.id,
          mappingId: form.mappingId,
          decision: form.slotDecision.kind === "ACCEPT" ? "ACCEPT" : "OVERRIDE_CLASSIFICATION",
          ...(form.slotDecision.kind === "OVERRIDE" ? { classification: form.slotDecision.classification } : {}),
          ...(form.slotEvidenceFrameStorageKey === null ? {} : { evidenceFrameStorageKey: form.slotEvidenceFrameStorageKey })
        });
      }
    }

    return ops;
  }

  /**
   * What the reviewer would actually LOSE by closing the drawer now.
   *
   * Deliberately not `buildOperations().length > 0`: that re-sends an
   * unchanged slot decision on every save (so it can never fall to zero once
   * a slot has been decided), which would leave this notice permanently on
   * screen and teach reviewers to ignore it. Every branch below compares the
   * form against the scene the plan really holds, so the notice appears
   * exactly when something is genuinely only in the browser.
   */
  function hasPendingChanges(): boolean {
    const currentScene = scene!;
    const trimmedDuration = finalDuration.trim();
    const nextDuration = trimmedDuration === "" ? null : Number(trimmedDuration);
    if (nextDuration !== currentScene.finalDuration) {
      return true;
    }
    const trimmedInstructions = instructions.trim();
    if ((trimmedInstructions === "" ? null : trimmedInstructions) !== currentScene.instructions) {
      return true;
    }
    return mappings.some((form) => {
      const originalMapping = currentScene.mappings.find((candidate) => candidate.id === form.mappingId);
      if (!originalMapping) {
        return false;
      }
      const trimmedText = form.text.trim();
      if ((trimmedText === "" ? null : trimmedText) !== originalMapping.text) {
        return true;
      }
      const trimmedTimestamp = form.assetTimestamp.trim();
      if ((trimmedTimestamp === "" ? null : Number(trimmedTimestamp)) !== originalMapping.assetTimestamp) {
        return true;
      }
      if (classificationFor(form.mappingId) === "color" && isBrandColorChanged(form.colorHex, originalMapping.colorHex)) {
        return true;
      }
      if ((form.selectedAssetId === "" ? null : form.selectedAssetId) !== originalMapping.selectedAssetId) {
        return true;
      }
      if (isOrientationChanged(form, originalMapping)) {
        return true;
      }
      if (form.templateTextDecision === null) {
        if ((originalMapping.keepTemplateText?.decision ?? null) !== null) {
          return true;
        }
      } else if (!isTemplateDecisionPersisted(form, originalMapping)) {
        return true;
      }
      if (form.slotDecision === null) {
        return (originalMapping.slotReview ?? null) !== null;
      }
      return !isSlotDecisionPersisted(form, originalMapping);
    });
  }

  /**
   * The slot findings for a mapping AS THE FORM CURRENTLY STANDS - including
   * an asset the reviewer has just picked but not yet saved, so the panel
   * shows what the plan would actually be judged on, not what it said before.
   * Uses the same shared assessment the backend gate runs, so the dashboard
   * can never disagree with the refusal that follows.
   */
  function assessSlot(form: MappingFormState): SlotAssessment | null {
    const currentScene = scene;
    const original = currentScene?.mappings.find((candidate) => candidate.id === form.mappingId);
    if (!currentScene || !original || !project) {
      return null;
    }
    const selectedAssetId = form.selectedAssetId === "" ? null : form.selectedAssetId;
    const selectedAsset = (assets ?? []).find((asset) => asset.id === selectedAssetId) ?? null;
    const mapping: PlaceholderMapping = {
      ...original,
      selectedAssetId,
      selectedAssetType: selectedAsset ? placeholderTypeForMediaKind(selectedAsset.mediaKind) : null
    };
    return assessMappingSlot({
      scene: currentScene,
      mapping,
      manifest: project.manifest,
      asset:
        selectedAsset === null
          ? null
          : {
              id: selectedAsset.id,
              widthPx: selectedAsset.width,
              heightPx: selectedAsset.height,
              hasAlphaChannel: selectedAsset.hasAlphaChannel ?? null,
              hasTransparentPixels: selectedAsset.hasTransparentPixels ?? null,
              transparentPixelRatio: selectedAsset.transparentPixelRatio ?? null,
              visibleCoverageRatio: selectedAsset.visibleCoverageRatio ?? null,
              visibleContentBounds: selectedAsset.visibleContentBounds ?? null
            }
    });
  }

  /**
   * Every way out of this drawer (Cancel, the header's close button, Escape,
   * a backdrop click) goes through here, because before today every one of
   * them threw the reviewer's decisions away in silence - see the 2026-09-24
   * run in docs/ACCEPTANCE.md. With nothing pending it closes exactly as it
   * always did; with something pending it asks first.
   */
  function requestClose(): void {
    if (isSaving) {
      return;
    }
    if (hasPendingChanges()) {
      setIsConfirmingDiscard(true);
      return;
    }
    onClose();
  }

  async function handleSave(): Promise<void> {
    const operations = buildOperations();
    if (operations.length === 0) {
      onClose();
      return;
    }
    setIsSaving(true);
    setError(null);
    const result = await applyEdit(operations);
    setIsSaving(false);
    if (result.ok) {
      onClose();
    } else {
      setError(result.message ?? null);
    }
  }

  // One section per composition the layers ACTUALLY live in. A single-master
  // template keeps every real scene in a nested composition, so without this
  // the drawer is one flat list in which 23 fieldsets are legended "Text A",
  // "Text B" or "Text C" and nobody can tell which scene they belong to - see
  // scene-placeholder-groups.ts for the full defect note.
  const renderGroups = groupMappingsByLayerPath(
    mappings.map((mapping) => ({ mappingId: mapping.mappingId, layerPath: manifestLayerPathFor(mapping.mappingId) }))
  );
  const mappingIndexById = new Map(mappings.map((mapping, index) => [mapping.mappingId, index]));
  const orderedForRender = renderGroups.flatMap((group) =>
    group.mappingIds.map((mappingId, positionInGroup) => {
      const index = mappingIndexById.get(mappingId) as number;
      return {
        mapping: mappings[index] as MappingFormState,
        // The ORIGINAL index into `mappings`, not the display position - every
        // onChange below writes back by index, so regrouping must never
        // renumber them.
        index,
        groupLabel:
          positionInGroup !== 0
            ? null
            : group.layerPath.length === 0
              ? t.projectWorkspace.editDrawer.ownLayersGroupLabel
              : placeholderGroupPathLabel(group)
      };
    })
  );

  // 2026-10-04 audit (seen on the live dashboard): in Simple view this drawer
  // was the Advanced one - "Edit scene mapping", every phone screen named
  // "White Solid 2" under a path in capitals, a structural verdict with
  // percentages under each picture, and a dozen colour pickers in between; one
  // scene's drawer was 5,700 px tall. Simple view now shows what a client
  // changes: pictures first, then texts, each under a plain name, with the
  // colours folded away and the expert-only fields left to Advanced view.
  // Nothing about what is SAVED changes - the same fields write the same
  // operations.
  const plainNames = new Map<string, string>();
  if (isSimple) {
    let pictureCount = 0;
    let textCount = 0;
    const totals = { picture: 0, text: 0 };
    for (const entry of orderedForRender) {
      const fields = fieldsFor(entry.mapping.mappingId);
      if (fields.asset) totals.picture++;
      else if (fields.text) totals.text++;
    }
    for (const entry of orderedForRender) {
      const fields = fieldsFor(entry.mapping.mappingId);
      if (fields.asset) {
        pictureCount++;
        plainNames.set(entry.mapping.mappingId, totals.picture === 1 ? t.projectWorkspace.editDrawer.simple.picture : t.projectWorkspace.editDrawer.simple.pictureN(pictureCount));
      } else if (fields.text) {
        textCount++;
        plainNames.set(entry.mapping.mappingId, totals.text === 1 ? t.projectWorkspace.editDrawer.simple.text : t.projectWorkspace.editDrawer.simple.textN(textCount));
      }
    }
  }
  // A text box nobody has settled: nothing typed, and no recorded "keep the template's text".
  const isUndecidedText = (mapping: MappingFormState): boolean =>
    fieldsFor(mapping.mappingId).text && mapping.text.trim() === "" && mapping.templateTextDecision === null;
  // What the line under a text box says. Advanced: as before. Simple: what the
  // video shows here now, in the template's own words when they are known.
  const textHintProps = (mapping: MappingFormState): { hint?: string } => {
    if (!isSimple) {
      return { hint: t.projectWorkspace.editDrawer.textHint };
    }
    const words = templateTextFor(mapping.mappingId).text ?? null;
    if (mapping.templateTextDecision === "NO_TEXT") {
      return { hint: t.projectWorkspace.editDrawer.simple.noTextHereHint };
    }
    if (mapping.text.trim() !== "") {
      return words === null ? {} : { hint: t.projectWorkspace.editDrawer.simple.textReplacesHint(words) };
    }
    return { hint: words === null ? t.projectWorkspace.editDrawer.simple.textEmptyHint : t.projectWorkspace.editDrawer.simple.textEmptyTemplateHint(words) };
  };
  const isColourEntry = (entry: (typeof orderedForRender)[number]): boolean => classificationFor(entry.mapping.mappingId) === "color";
  const rank = (entry: (typeof orderedForRender)[number]): number => (fieldsFor(entry.mapping.mappingId).asset ? 0 : 1);
  const mainEntries = isSimple ? orderedForRender.filter((entry) => !isColourEntry(entry)).sort((a, b) => rank(a) - rank(b)) : orderedForRender;
  const colourEntries = isSimple ? orderedForRender.filter(isColourEntry) : [];

  return (
    <Dialog open onClose={requestClose} title={isSimple ? t.projectWorkspace.editDrawer.simple.title : t.projectWorkspace.editDrawer.title} variant="drawer">
      <div className="edit-drawer-form">
        {error ? <ErrorState title={t.projectWorkspace.saveFailedTitle} description={error} /> : null}
        {hasPendingChanges() ? (
          <p className="unsaved-changes-notice" role="status">
            {t.projectWorkspace.editDrawer.unsavedChangesNotice}
          </p>
        ) : null}
        {isSimple ? null : (
        <>
        <Field label={t.projectWorkspace.editDrawer.finalDurationLabel} htmlFor="scene-final-duration">
          <Input
            id="scene-final-duration"
            type="number"
            min="0"
            step="0.1"
            value={finalDuration}
            onChange={(event) => setFinalDuration(event.target.value)}
          />
        </Field>
        <Field label={t.projectWorkspace.editDrawer.instructionsLabel} htmlFor="scene-instructions">
          <textarea
            id="scene-instructions"
            className="input"
            rows={3}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </Field>
        </>
        )}
        {mappings.length === 0 ? (
          <EmptyState
            title={t.projectWorkspace.editDrawer.noMappingsTitle}
            description={t.projectWorkspace.editDrawer.noMappingsDescription}
          />
        ) : null}
        {(() => {
          const renderEntry = ({ mapping, index, groupLabel }: (typeof orderedForRender)[number]) => (
          <div key={mapping.mappingId} className="edit-drawer-group-item">
            {groupLabel === null || isSimple ? null : (
              <h3 className="edit-drawer-group-heading">
                {groupLabel}
                <span className="edit-drawer-group-heading__hint">{t.projectWorkspace.editDrawer.groupPathHint}</span>
              </h3>
            )}
            <fieldset className="edit-drawer-form">
            <legend title={isSimple ? mapping.label : undefined}>
              {plainNames.get(mapping.mappingId) ?? mapping.label}
              {isSimple && isUndecidedText(mapping) ? <span className="edit-drawer-open-mark">{t.projectWorkspace.editDrawer.simple.textNotFilledMark}</span> : null}
              {/* What this layer takes, in a word - the layer's own name ("White Solid 2") rarely says. */}
              {isSimple && plainNames.has(mapping.mappingId) ? null : (
              (() => {
                const kind = classificationFor(mapping.mappingId);
                const kindLabel = kind === null ? undefined : (t.projectWorkspace.editDrawer.layerKindLabels as Record<string, string | undefined>)[kind];
                return kindLabel === undefined ? null : <span className="edit-drawer-kind">{kindLabel}</span>;
              })()
              )}
            </legend>
            {/*
              REAL 2026-10-06: the client could not find where the example's
              background logo goes. It is "Picture 2" of the last scene - and
              nothing told "Picture 1" (a phone screen) from "Picture 2" (the
              large picture behind everything). The one fact that does is the
              name the template's author gave the place, so Simple view shows
              it, as the template's word and not as ours.
            */}
            {isSimple && fieldsFor(mapping.mappingId).asset && (manifestLayerPathFor(mapping.mappingId) ?? []).length > 0 ? (
              <p className="field__hint">{t.projectWorkspace.editDrawer.simple.templatePlaceName(String((manifestLayerPathFor(mapping.mappingId) ?? []).slice(-1)[0]))}</p>
            ) : null}
            {fieldsFor(mapping.mappingId).asset ? (
            <Field
              label={isSimple ? t.projectWorkspace.editDrawer.simple.pictureFieldLabel : t.projectWorkspace.editDrawer.assetLabel}
              htmlFor={`mapping-asset-${mapping.mappingId}`}
              hint={isSimple ? t.projectWorkspace.editDrawer.simple.pictureFieldHint : t.projectWorkspace.editDrawer.assetHint}
            >
              <Select
                id={`mapping-asset-${mapping.mappingId}`}
                value={mapping.selectedAssetId}
                onChange={(event) => {
                  const next = [...mappings];
                  next[index] = { ...mapping, selectedAssetId: event.target.value };
                  setMappings(next);
                }}
              >
                <option value="">{isSimple ? t.projectWorkspace.editDrawer.simple.noPictureOption : t.projectWorkspace.editDrawer.assetUnmappedOption}</option>
                {(assets ?? []).map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.label ?? asset.originalFilename}
                  </option>
                ))}
              </Select>
            </Field>
            ) : null}
            {fieldsFor(mapping.mappingId).asset && mapping.selectedAssetId !== "" ? (
            <Field label={t.projectWorkspace.editDrawer.orientationLabel} htmlFor={`mapping-turn-${mapping.mappingId}`} hint={t.projectWorkspace.editDrawer.orientationHint}>
              <div className="edit-drawer-orientation">
                <label className="edit-drawer-orientation__flip">
                  <input
                    type="checkbox"
                    checked={mapping.mirror}
                    onChange={(event) => {
                      const next = [...mappings];
                      next[index] = { ...mapping, mirror: event.target.checked };
                      setMappings(next);
                    }}
                  />
                  {t.projectWorkspace.editDrawer.orientationFlip}
                </label>
                <Select
                  id={`mapping-turn-${mapping.mappingId}`}
                  value={String(mapping.quarterTurns)}
                  onChange={(event) => {
                    const turns = Number(event.target.value);
                    const next = [...mappings];
                    next[index] = { ...mapping, quarterTurns: turns === 1 || turns === 2 || turns === 3 ? turns : 0 };
                    setMappings(next);
                  }}
                >
                  <option value="0">{t.projectWorkspace.editDrawer.orientationTurnNone}</option>
                  <option value="1">{t.projectWorkspace.editDrawer.orientationTurnRight}</option>
                  <option value="2">{t.projectWorkspace.editDrawer.orientationTurnHalf}</option>
                  <option value="3">{t.projectWorkspace.editDrawer.orientationTurnLeft}</option>
                </Select>
              </div>
            </Field>
            ) : null}
            {fieldsFor(mapping.mappingId).text ? (
            <Field label={t.projectWorkspace.editDrawer.textLabel} htmlFor={`mapping-text-${mapping.mappingId}`} {...textHintProps(mapping)}>
              <Input
                id={`mapping-text-${mapping.mappingId}`}
                value={mapping.text}
                dir="auto"
                /* The template's own wording, shown faintly so the reviewer sees what this line replaces. Not in Simple view: there a grey word in an empty box read as a filled one (2026-10-06), so the line under the box says it instead. */
                placeholder={isSimple ? undefined : (templateTextFor(mapping.mappingId).text ?? templateTextFor(mapping.mappingId).preview ?? undefined)}
                disabled={isSimple && mapping.templateTextDecision === "NO_TEXT"}
                onChange={(event) => {
                  const next = [...mappings];
                  next[index] = { ...mapping, text: event.target.value };
                  setMappings(next);
                }}
              />
              {/* 2026-10-06, the client: "I put header and subheader, and I don't want the small text" - there was no way to say so. */}
              {isSimple ? (
                <label className="edit-drawer-no-text">
                  <input
                    type="checkbox"
                    checked={mapping.templateTextDecision === "NO_TEXT"}
                    onChange={(event) => {
                      const next = [...mappings];
                      next[index] = event.target.checked ? { ...mapping, text: "", templateTextDecision: "NO_TEXT" } : { ...mapping, templateTextDecision: null };
                      setMappings(next);
                    }}
                  />
                  {t.projectWorkspace.editDrawer.simple.noTextHere}
                </label>
              ) : null}
            </Field>
            ) : null}
            {(() => {
              if (classificationFor(mapping.mappingId) !== "color") {
                return null;
              }
              // A nested colour layer is deliberately NOT offered a picker:
              // the worker refuses SET_BRAND_COLOR through a nested target
              // (see build-manifest.ts decideNestedLayer), so a field here
              // would promise an edit that can never run.
              const colorControl = colorControlFor(mapping.mappingId);
              if (colorControl === null && (manifestLayerPathFor(mapping.mappingId) ?? []).length > 0) {
                return <p className="field__hint">{t.projectWorkspace.editDrawer.colorNestedUnsupported}</p>;
              }
              const templateColor = colorControl?.currentColorHex ?? null;
              // A colour on screen for a moment (a fade at the end) says so - a client set one to white as "the background" (2026-10-07).
              const timing = manifestTimingFor(mapping.mappingId);
              const brief = timing !== null && videoSeconds > 0 && timing.durationSeconds < videoSeconds * 0.1;
              const clock = (seconds: number): string => `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2, "0")}`;
              const simpleHint = brief && timing !== null
                ? t.projectWorkspace.editDrawer.simple.colourBriefHint(clock(timing.startSeconds), timing.durationSeconds)
                : t.projectWorkspace.editDrawer.simple.colourHint;
              const setColor = (value: string): void => {
                const next = [...mappings];
                next[index] = { ...mapping, colorHex: value };
                setMappings(next);
              };
              return (
                <Field
                  label={t.projectWorkspace.editDrawer.colorLabel}
                  htmlFor={`mapping-color-${mapping.mappingId}`}
                  hint={isSimple ? simpleHint : templateColor === null ? t.projectWorkspace.editDrawer.colorHint : t.projectWorkspace.editDrawer.colorControlHint(templateColor)}
                >
                  <div className="edit-drawer-color">
                    <Input
                      id={`mapping-color-${mapping.mappingId}`}
                      value={mapping.colorHex}
                      placeholder="#RRGGBB"
                      onChange={(event) => setColor(event.target.value)}
                    />
                    <input
                      type="color"
                      className="edit-drawer-color__swatch"
                      aria-label={t.projectWorkspace.editDrawer.colorSwatchLabel}
                      /* A native colour input cannot represent "unset", so an
                         empty or partial value shows black WITHOUT the form
                         state claiming black was chosen - only a real change
                         event writes a colour. */
                      value={/^#[0-9A-Fa-f]{6}$/.test(mapping.colorHex) ? mapping.colorHex : (templateColor ?? "#000000")}
                      onChange={(event) => setColor(event.target.value)}
                    />
                    {mapping.colorHex === "" ? null : (
                      <Button size="sm" variant="ghost" onClick={() => setColor("")}>
                        {t.projectWorkspace.editDrawer.colorClearAction}
                      </Button>
                    )}
                  </div>
                </Field>
              );
            })()}
            {(() => {
              const assessment = assessMapping(mapping);
              if (assessment.status === "NOT_APPLICABLE" || assessment.status === "REPLACED") {
                return null;
              }
              const template = templateTextFor(mapping.mappingId);
              const warning =
                assessment.status === "TEMPLATE_TEXT_UNKNOWN"
                  ? t.projectWorkspace.editDrawer.templateCopyUnknownWarning
                  : assessment.status === "TEMPLATE_TEXT_CAPTURE_FAILED"
                    ? t.projectWorkspace.editDrawer.templateCopyCaptureFailedWarning
                    : assessment.status === "TEMPLATE_TEXT_TOO_LARGE_TO_VERIFY"
                      ? t.projectWorkspace.editDrawer.templateCopyTooLargeWarning(template.codeUnitLength ?? 0)
                      : assessment.status === "IDENTICAL"
                        ? t.projectWorkspace.editDrawer.templateCopyIdenticalWarning
                        : t.projectWorkspace.editDrawer.templateCopyVariantWarning;
              // A terminal size blocker and an uncheckable manifest both offer
              // NO decision: there is nothing verified to keep or replace.
              const offersDecision =
                assessment.status === "IDENTICAL" || assessment.status === "TRIVIAL_VARIANT";
              return (
                <div className="template-copy-warning" role="status" data-blocks={assessment.blocks ? "true" : "false"}>
                  <p>{warning}</p>
                  {assessment.decisionState === "STALE" ? <p>{t.projectWorkspace.editDrawer.templateCopyStaleWarning}</p> : null}
                  {typeof template.text === "string" ? (
                    <p>
                      <span>{t.projectWorkspace.editDrawer.templateCopyTemplateTextLabel}: </span>
                      <code>{template.text}</code>
                    </p>
                  ) : null}
                  {template.truncated && template.preview !== null ? (
                    <p>
                      <span>{t.projectWorkspace.editDrawer.templateCopyExcerptLabel}: </span>
                      <code>{template.preview}</code>
                      <span>
                        {" "}
                        {t.projectWorkspace.editDrawer.templateCopyExcerptNote(template.verification?.codeUnitLength ?? 0)}
                      </span>
                    </p>
                  ) : null}
                  {!offersDecision ? null : (
                    <>
                      <p>{t.projectWorkspace.editDrawer.templateCopyDecisionHint}</p>
                      <div className="template-copy-actions">
                        <Button
                          variant={mapping.templateTextDecision === "REPLACE" ? "primary" : "ghost"}
                          onClick={() => {
                            const next = [...mappings];
                            next[index] = { ...mapping, templateTextDecision: "REPLACE" };
                            setMappings(next);
                          }}
                        >
                          {t.projectWorkspace.editDrawer.templateCopyReplace}
                        </Button>
                        <Button
                          variant={mapping.templateTextDecision === "KEEP_TEMPLATE_TEXT" ? "primary" : "ghost"}
                          onClick={() => {
                            const next = [...mappings];
                            next[index] = { ...mapping, templateTextDecision: "KEEP_TEMPLATE_TEXT" };
                            setMappings(next);
                          }}
                        >
                          {t.projectWorkspace.editDrawer.templateCopyKeep}
                        </Button>
                        {mapping.templateTextDecision === null ? null : (
                          <Button
                            variant="ghost"
                            onClick={() => {
                              const next = [...mappings];
                              next[index] = { ...mapping, templateTextDecision: null };
                              setMappings(next);
                            }}
                          >
                            {t.projectWorkspace.editDrawer.templateCopyClearDecision}
                          </Button>
                        )}
                      </div>
                      {(() => {
                        // Exactly the same rule as the slot decision below: a
                        // decision the plan holds reads as recorded, a
                        // decision only clicked here reads as pending.
                        if (mapping.templateTextDecision === null) {
                          return null;
                        }
                        const original = scene!.mappings.find((candidate) => candidate.id === mapping.mappingId);
                        const persisted = original !== undefined && isTemplateDecisionPersisted(mapping, original);
                        if (persisted) {
                          return (
                            <p>
                              {mapping.templateTextDecision === "REPLACE"
                                ? t.projectWorkspace.editDrawer.templateCopyDecidedReplace
                                : t.projectWorkspace.editDrawer.templateCopyDecidedKeep}
                            </p>
                          );
                        }
                        return (
                          <p className="pending-decision">
                            {mapping.templateTextDecision === "REPLACE"
                              ? t.projectWorkspace.editDrawer.templateCopyPendingReplace
                              : t.projectWorkspace.editDrawer.templateCopyPendingKeep}
                          </p>
                        );
                      })()}
                    </>
                  )}
                </div>
              );
            })()}
            {(() => {
              const slotAssessment = assessSlot(mapping);
              if (!slotAssessment || slotAssessment.blockers.length === 0) {
                return null;
              }
              const original = scene!.mappings.find((candidate) => candidate.id === mapping.mappingId);
              const recorded = original?.slotReview ?? null;
              const currentDigest = slotEvidenceDigest(slotAssessment);
              // Simple view: a place already confirmed (the picture check at the
              // top of the Scenes page records it) shows nothing here. One that
              // still needs a decision, or whose decision went stale, shows the
              // full panel - a gate is never hidden.
              if (isSimple && recorded !== null && recorded.evidenceDigest === currentDigest) {
                return null;
              }
              // 2026-10-07: in Simple view the same question stood here in the
              // reviewer's words ("It is a device screen / a flat card", "Recorded:
              // accepted after looking at the frame") whenever a flip or a new
              // picture made the recorded check stale. The picture check at the
              // top of the Scenes page asks it in the client's words; here it is
              // one line pointing there.
              if (isSimple) {
                return <p className="field__hint">{t.projectWorkspace.editDrawer.simple.placeCheckedOnScenesPage}</p>;
              }
              return (
                <SlotReviewPanel
                  scenePlanId={scene!.id}
                  mappingId={mapping.mappingId}
                  assessment={slotAssessment}
                  decisionIsStale={recorded !== null && recorded.evidenceDigest !== currentDigest}
                  choice={mapping.slotDecision}
                  choiceIsSaved={original !== undefined && isSlotDecisionPersisted(mapping, original)}
                  onChoose={(choice) => {
                    // A functional update that touches only this field: the
                    // panel reports its evidence frame asynchronously, and
                    // writing back a copy captured at render time would drop
                    // that frame - leaving a decision the API then refuses.
                    setMappings((current) =>
                      current.map((entry) => (entry.mappingId === mapping.mappingId ? { ...entry, slotDecision: choice } : entry))
                    );
                  }}
                  onEvidenceFrame={(storageKey) => {
                    // Returns the SAME array when nothing changed: a new array
                    // every time would re-render the panel, which reports the
                    // frame again, which sets state again - a loop.
                    setMappings((current) => {
                      const existing = current.find((entry) => entry.mappingId === mapping.mappingId);
                      if (!existing || existing.slotEvidenceFrameStorageKey === storageKey) {
                        return current;
                      }
                      return current.map((entry) =>
                        entry.mappingId === mapping.mappingId ? { ...entry, slotEvidenceFrameStorageKey: storageKey } : entry
                      );
                    });
                  }}
                />
              );
            })()}
            {fieldsFor(mapping.mappingId).timestamp && !isSimple ? (
            <Field label={t.projectWorkspace.editDrawer.assetTimestampLabel} htmlFor={`mapping-timestamp-${mapping.mappingId}`}>
              <Input
                id={`mapping-timestamp-${mapping.mappingId}`}
                type="number"
                min="0"
                step="0.1"
                value={mapping.assetTimestamp}
                onChange={(event) => {
                  const next = [...mappings];
                  next[index] = { ...mapping, assetTimestamp: event.target.value };
                  setMappings(next);
                }}
              />
            </Field>
            ) : null}
            </fieldset>
          </div>
          );
          return (
            <>
              {mainEntries.map(renderEntry)}
              {colourEntries.length === 0 ? null : (
                <details className="edit-drawer-colours">
                  <summary>{t.projectWorkspace.editDrawer.simple.coloursSummary(colourEntries.length)}</summary>
                  <p className="field__hint">{t.projectWorkspace.editDrawer.simple.coloursHint}</p>
                  {colourEntries.map(renderEntry)}
                </details>
              )}
            </>
          );
        })()}
        <div className="edit-drawer-actions">
          <Button variant="ghost" onClick={requestClose} disabled={isSaving}>
            {t.projectWorkspace.editDrawer.cancel}
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? t.projectWorkspace.savingLabel : t.projectWorkspace.editDrawer.save}
          </Button>
        </div>
      </div>
      <Dialog
        open={isConfirmingDiscard}
        onClose={() => setIsConfirmingDiscard(false)}
        title={t.projectWorkspace.editDrawer.discardConfirmTitle}
        variant="modal"
      >
        <p>{t.projectWorkspace.editDrawer.discardConfirmDescription}</p>
        <div className="edit-drawer-actions">
          <Button variant="ghost" onClick={() => setIsConfirmingDiscard(false)}>
            {t.projectWorkspace.editDrawer.discardConfirmKeepEditing}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setIsConfirmingDiscard(false);
              onClose();
            }}
          >
            {t.projectWorkspace.editDrawer.discardConfirmDiscard}
          </Button>
        </div>
      </Dialog>
    </Dialog>
  );
}
