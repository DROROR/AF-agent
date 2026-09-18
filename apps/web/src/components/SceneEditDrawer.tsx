"use client";

import { useEffect, useState, type ReactElement } from "react";
import { assessTemplateCopy, type ExecutionPlanEditOperation, type MediaKind, type PlaceholderType, type TemplateCopyAssessment, type TemplateTextDecision } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useProjectAssets } from "../lib/use-project-assets";
import { Dialog } from "./ui/Dialog";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Button } from "./ui/Button";
import { ErrorState } from "./ErrorState";
import { useLocale } from "./LocaleProvider";

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
        templateTextDecision: mapping.keepTemplateText?.decision ?? null
      }))
    );
    setError(null);
  }, [scene]);

  if (!scenePlanId || !scene) {
    return null;
  }

  /**
   * The template's own wording for a mapping, from the project's CURRENT
   * manifest. `undefined` means this manifest never captured it (an older
   * inspection), which the shared gate reports as blocking - the dashboard
   * never invents a value to make the warning go away.
   */
  function templateTextFor(mappingId: string): string | null | undefined {
    const mapping = scene!.mappings.find((candidate) => candidate.id === mappingId);
    if (!mapping || mapping.manifestPlaceholderId === null) {
      return null;
    }
    for (const manifestScene of project?.manifest.scenes ?? []) {
      for (const placeholder of manifestScene.placeholders) {
        if (placeholder.placeholderId === mapping.manifestPlaceholderId) {
          return placeholder.originalTextTruncated === true ? undefined : placeholder.originalText;
        }
      }
    }
    return undefined;
  }

  /** Assessed with the SAME pure function the backend gate uses, against the text currently typed in the form - so the warning tracks what the reviewer is actually about to save. */
  function assessMapping(form: MappingFormState): TemplateCopyAssessment {
    const original = scene!.mappings.find((candidate) => candidate.id === form.mappingId);
    const trimmed = form.text.trim();
    const typedText = trimmed === "" ? null : trimmed;
    return assessTemplateCopy({
      mappingText: typedText,
      templateText: templateTextFor(form.mappingId),
      decision:
        form.templateTextDecision === null
          ? null
          : {
              decision: form.templateTextDecision,
              decidedBy: original?.keepTemplateText?.decidedBy ?? "pending",
              decidedAt: original?.keepTemplateText?.decidedAt ?? new Date(0).toISOString(),
              // A choice made in this form session is about the text in this
              // form session - saving records exactly that.
              textAtDecision: typedText ?? ""
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
    }

    return ops;
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
              const templateText = templateTextFor(mapping.mappingId);
              const warning =
                assessment.status === "TEMPLATE_TEXT_UNKNOWN"
                  ? t.projectWorkspace.editDrawer.templateCopyUnknownWarning
                  : assessment.status === "IDENTICAL"
                    ? t.projectWorkspace.editDrawer.templateCopyIdenticalWarning
                    : t.projectWorkspace.editDrawer.templateCopyVariantWarning;
              return (
                <div className="template-copy-warning" role="status" data-blocks={assessment.blocks ? "true" : "false"}>
                  <p>{warning}</p>
                  {assessment.decisionState === "STALE" ? <p>{t.projectWorkspace.editDrawer.templateCopyStaleWarning}</p> : null}
                  {typeof templateText === "string" ? (
                    <p>
                      <span>{t.projectWorkspace.editDrawer.templateCopyTemplateTextLabel}: </span>
                      <code>{templateText}</code>
                    </p>
                  ) : null}
                  {assessment.status === "TEMPLATE_TEXT_UNKNOWN" ? null : (
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
