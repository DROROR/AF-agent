"use client";

import { useEffect, useState, type ReactElement } from "react";
import type { ExecutionPlanEditOperation } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { Dialog } from "./ui/Dialog";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { ErrorState } from "./ErrorState";
import { useLocale } from "./LocaleProvider";

export interface SceneEditDrawerProps {
  scenePlanId: string | null;
  onClose: () => void;
}

interface MappingFormState {
  mappingId: string;
  label: string;
  text: string;
  assetTimestamp: string;
}

/**
 * Edits exactly the fields Phase 6's edit contract supports (section 9 of
 * the dashboard-integration task): scene-level finalDuration/instructions,
 * and per-mapping text/assetTimestamp. Never offers an asset picker - no
 * real asset catalog exists yet, so MAP_ASSET is intentionally not wired
 * here (see SceneTable's Asset column, which only ever displays the real
 * stored value or "No assets uploaded"). Submits every changed field as
 * one batched PATCH (one revision bump), diffed against the scene's
 * current real values - an untouched field is never resent/cleared.
 */
export function SceneEditDrawer({ scenePlanId, onClose }: SceneEditDrawerProps): ReactElement | null {
  const { t } = useLocale();
  const { plan, applyEdit } = useProjectWorkspaceContext();
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
        assetTimestamp: mapping.assetTimestamp !== null ? String(mapping.assetTimestamp) : ""
      }))
    );
    setError(null);
  }, [scene]);

  if (!scenePlanId || !scene) {
    return null;
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
