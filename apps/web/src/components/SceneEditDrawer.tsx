"use client";

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
import { useLocale } from "./LocaleProvider";
import { SlotReviewPanel, type SlotReviewChoice } from "./SlotReviewPanel";

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
}

interface MappingFormState {
  mappingId: string;
  label: string;
  text: string;
  assetTimestamp: string;
  selectedAssetId: string;
  /** The reviewer's explicit choice in THIS form session, or null while undecided - never defaulted, since a default would be a decision nobody made. */
  templateTextDecision: TemplateTextDecision | null;
  /** The reviewer's explicit SLOT decision in this form session (Stage 4), or null while undecided - same rule. */
  slotDecision: SlotReviewChoice | null;
  /** The evidence frame the panel is currently showing, which is the only frame a slot decision may be recorded against. */
  slotEvidenceFrameStorageKey: string | null;
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
export function SceneEditDrawer({ scenePlanId, onClose }: SceneEditDrawerProps): ReactElement | null {
  const { t } = useLocale();
  const { project, plan, applyEdit } = useProjectWorkspaceContext();
  const { assets } = useProjectAssets(project?.project.projectId ?? "");
  const [finalDuration, setFinalDuration] = useState("");
  const [instructions, setInstructions] = useState("");
  const [mappings, setMappings] = useState<MappingFormState[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scene = plan?.plan.scenePlans.find((candidate) => candidate.id === scenePlanId) ?? null;

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
      scene.mappings.map((mapping) => ({
        mappingId: mapping.id,
        label: mapping.placeholderName ?? mapping.id,
        text: mapping.text ?? "",
        assetTimestamp: mapping.assetTimestamp !== null ? String(mapping.assetTimestamp) : "",
        selectedAssetId: mapping.selectedAssetId ?? "",
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
  }, [scene]);

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

  return (
    <Dialog open onClose={onClose} title={t.projectWorkspace.editDrawer.title} variant="drawer">
      <div className="edit-drawer-form">
        {error ? <ErrorState title={t.projectWorkspace.saveFailedTitle} description={error} /> : null}
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
        {mappings.map((mapping, index) => (
          <fieldset key={mapping.mappingId} className="edit-drawer-form">
            <legend>{mapping.label}</legend>
            <Field label={t.projectWorkspace.editDrawer.assetLabel} htmlFor={`mapping-asset-${mapping.mappingId}`} hint={t.projectWorkspace.editDrawer.assetHint}>
              <Select
                id={`mapping-asset-${mapping.mappingId}`}
                value={mapping.selectedAssetId}
                onChange={(event) => {
                  const next = [...mappings];
                  next[index] = { ...mapping, selectedAssetId: event.target.value };
                  setMappings(next);
                }}
              >
                <option value="">{t.projectWorkspace.editDrawer.assetUnmappedOption}</option>
                {(assets ?? []).map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.label ?? asset.originalFilename}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t.projectWorkspace.editDrawer.textLabel} htmlFor={`mapping-text-${mapping.mappingId}`} hint={t.projectWorkspace.editDrawer.textHint}>
              <Input
                id={`mapping-text-${mapping.mappingId}`}
                value={mapping.text}
                onChange={(event) => {
                  const next = [...mappings];
                  next[index] = { ...mapping, text: event.target.value };
                  setMappings(next);
                }}
              />
            </Field>
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
                      {mapping.templateTextDecision === null ? null : (
                        <p>
                          {mapping.templateTextDecision === "REPLACE"
                            ? t.projectWorkspace.editDrawer.templateCopyDecidedReplace
                            : t.projectWorkspace.editDrawer.templateCopyDecidedKeep}
                        </p>
                      )}
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
              const recorded = scene!.mappings.find((candidate) => candidate.id === mapping.mappingId)?.slotReview ?? null;
              const currentDigest = slotEvidenceDigest(slotAssessment);
              return (
                <SlotReviewPanel
                  scenePlanId={scene!.id}
                  mappingId={mapping.mappingId}
                  assessment={slotAssessment}
                  decisionIsStale={recorded !== null && recorded.evidenceDigest !== currentDigest}
                  choice={mapping.slotDecision}
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
          </fieldset>
        ))}
        <div className="edit-drawer-actions">
          <Button variant="ghost" onClick={onClose} disabled={isSaving}>
            {t.projectWorkspace.editDrawer.cancel}
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? t.projectWorkspace.savingLabel : t.projectWorkspace.editDrawer.save}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
