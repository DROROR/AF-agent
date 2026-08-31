"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { ProjectResponse, WorkMapEntry } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useWorkMap } from "../lib/use-work-map";
import { useProjectAssets } from "../lib/use-project-assets";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { ClaudeActionButton } from "./ui/ClaudeActionButton";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Skeleton } from "./ui/Skeleton";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { useLocale } from "./LocaleProvider";

interface RowForm {
  id?: string;
  sourceCompositionId: string;
  sourceReference: string;
  desiredAssetId: string;
  desiredText: string;
  assetTimestampSeconds: string;
  desiredDurationSeconds: string;
  instructions: string;
}

function emptyRow(): RowForm {
  return {
    sourceCompositionId: "",
    sourceReference: "",
    desiredAssetId: "",
    desiredText: "",
    assetTimestampSeconds: "",
    desiredDurationSeconds: "",
    instructions: ""
  };
}

function toRowForm(entry: WorkMapEntry): RowForm {
  return {
    id: entry.id,
    sourceCompositionId: entry.sourceCompositionId ?? "",
    sourceReference: entry.sourceReference ?? "",
    desiredAssetId: entry.desiredAssetId ?? "",
    desiredText: entry.desiredText ?? "",
    assetTimestampSeconds: entry.assetTimestampSeconds !== null ? String(entry.assetTimestampSeconds) : "",
    desiredDurationSeconds: entry.desiredDurationSeconds !== null ? String(entry.desiredDurationSeconds) : "",
    instructions: entry.instructions ?? ""
  };
}

function toEntry(row: RowForm): Omit<WorkMapEntry, "id"> & { id?: string } {
  const trimmedTimestamp = row.assetTimestampSeconds.trim();
  const trimmedDuration = row.desiredDurationSeconds.trim();
  return {
    ...(row.id ? { id: row.id } : {}),
    sourceCompositionId: row.sourceCompositionId.trim() === "" ? null : row.sourceCompositionId.trim(),
    sourceReference: row.sourceReference.trim() === "" ? null : row.sourceReference.trim(),
    desiredAssetId: row.desiredAssetId.trim() === "" ? null : row.desiredAssetId.trim(),
    desiredText: row.desiredText.trim() === "" ? null : row.desiredText.trim(),
    assetTimestampSeconds: trimmedTimestamp === "" ? null : Number(trimmedTimestamp),
    desiredDurationSeconds: trimmedDuration === "" ? null : Number(trimmedDuration),
    instructions: row.instructions.trim() === "" ? null : row.instructions.trim()
  };
}

export function ProjectWorkMapTab(): ReactElement | null {
  const { project } = useProjectWorkspaceContext();

  if (!project) {
    return null;
  }

  return <WorkMapPanel project={project} />;
}

/**
 * Video-planning UX simplification, 2026-08-31 (CLAUDE.md-adjacent product
 * task, not a Mission-architecture change): three views over the SAME
 * real Work Map data/API this tab always had -
 * "tellAi" (default when no entries exist yet - the AI-first, plain-
 * English entry point), "planPreview" (a human-readable read of the
 * current entries: scene name, asset filename, text, duration - never raw
 * UUIDs), and "manualForm" (the original, still fully-supported free-form
 * editor, now with human-friendly asset/scene pickers instead of raw-ID
 * text inputs). Advanced/technical fields (composition ID, asset ID) are
 * never removed from the data model - "manualForm" and the plan preview's
 * own "Advanced details" disclosure keep them fully available, just not
 * required for the default experience.
 */
type ViewMode = "tellAi" | "planPreview" | "manualForm";

function WorkMapPanel({ project }: { project: ProjectResponse }): ReactElement {
  const projectId = project.project.projectId;
  const { t } = useLocale();
  const { workMap, isLoading, error, isStale, refetch, save, createAiDraft } = useWorkMap(projectId);
  const { assets } = useProjectAssets(projectId);
  const [rows, setRows] = useState<RowForm[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);
  const [createPlanError, setCreatePlanError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("tellAi");
  const [hasEnteredPreviewOnce, setHasEnteredPreviewOnce] = useState(false);

  useEffect(() => {
    // Synchronizes local editable rows from the real work map whenever it
    // (re)loads - same "derive editable state from an external value"
    // pattern as SceneEditDrawer.tsx's own effect, exempt from
    // react-hooks/set-state-in-effect for the same reason.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(workMap ? workMap.entries.map(toRowForm) : []);
  }, [workMap]);

  useEffect(() => {
    // A project that already has real Work Map entries (from a previous
    // AI draft, or a previous manual save) opens straight into the plan
    // preview - "Tell AI what you want" is only ever the FIRST thing a
    // normal user sees, never a return trip once a real plan exists.
    if (!isLoading && !hasEnteredPreviewOnce && workMap && workMap.entries.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewMode("planPreview");
      setHasEnteredPreviewOnce(true);
    }
  }, [isLoading, workMap, hasEnteredPreviewOnce]);

  const sceneNameByCompositionId = useMemo(() => new Map(project.manifest.compositions.map((composition) => [composition.compositionId, composition.name])), [project.manifest.compositions]);
  const assetById = useMemo(() => new Map((assets ?? []).map((asset) => [asset.id, asset])), [assets]);

  function resolveSceneName(entry: WorkMapEntry): string {
    if (entry.sourceCompositionId) {
      return sceneNameByCompositionId.get(entry.sourceCompositionId) ?? entry.sourceReference ?? entry.sourceCompositionId;
    }
    return entry.sourceReference ?? t.workMapTab.planPreview.noContent;
  }

  function resolveAssetLabel(entry: WorkMapEntry): string | null {
    if (!entry.desiredAssetId) {
      return null;
    }
    const asset = assetById.get(entry.desiredAssetId);
    return asset ? (asset.label ?? asset.originalFilename) : entry.desiredAssetId;
  }

  function updateRow(index: number, patch: Partial<RowForm>): void {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow(): void {
    setRows((current) => [...current, emptyRow()]);
  }

  function removeRow(index: number): void {
    setRows((current) => current.filter((_, i) => i !== index));
  }

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    setSaveError(null);
    const result = await save(rows.map(toEntry));
    setIsSaving(false);
    if (result.ok) {
      setViewMode("planPreview");
    } else {
      setSaveError(result.message ?? null);
    }
  }

  async function handleCreatePlan(): Promise<void> {
    if (instructions.trim() === "") {
      return;
    }
    setIsCreatingPlan(true);
    setCreatePlanError(null);
    const result = await createAiDraft(instructions.trim());
    setIsCreatingPlan(false);
    if (result.ok) {
      setHasEnteredPreviewOnce(true);
      setViewMode("planPreview");
    } else {
      setCreatePlanError(result.message ?? null);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <Skeleton height="1.5rem" />
      </Card>
    );
  }

  if (error) {
    return <ErrorState title={t.projectWorkspace.loadErrorTitle} description={error} />;
  }

  if (isStale) {
    return (
      <Card>
        <ErrorState title={t.projectWorkspace.staleRevisionTitle} description={t.projectWorkspace.staleRevisionDescription} />
        <Button variant="secondary" size="sm" onClick={() => void refetch()}>
          {t.projectWorkspace.reload}
        </Button>
      </Card>
    );
  }

  if (viewMode === "tellAi") {
    return (
      <Card>
        <CardHeader title={t.workMapTab.ai.heading} />
        <p>{t.workMapTab.description}</p>
        {createPlanError ? <ErrorState title={t.workMapTab.ai.createPlanFailedTitle} description={createPlanError} /> : null}
        <Field label={t.workMapTab.ai.textareaLabel} htmlFor="work-map-ai-instructions">
          <textarea
            id="work-map-ai-instructions"
            className="input"
            rows={6}
            placeholder={t.workMapTab.ai.placeholder}
            value={instructions}
            disabled={isCreatingPlan}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </Field>
        <div className="edit-drawer-actions">
          <Button variant="secondary" disabled={isCreatingPlan} onClick={() => setViewMode("manualForm")}>
            {t.workMapTab.ai.addDetailsManually}
          </Button>
          <ClaudeActionButton
            label={t.workMapTab.ai.createPlanAction}
            busyLabel={t.workMapTab.ai.creatingPlan}
            busy={isCreatingPlan}
            disabled={instructions.trim() === ""}
            onClick={() => void handleCreatePlan()}
          />
        </div>
      </Card>
    );
  }

  if (viewMode === "planPreview") {
    const entries = workMap?.entries ?? [];
    return (
      <Card>
        <CardHeader title={t.workMapTab.planPreview.title} />
        <p>{t.workMapTab.planPreview.description}</p>
        {entries.length === 0 ? (
          <EmptyState title={t.workMapTab.emptyTitle} description={t.workMapTab.emptyDescription} />
        ) : (
          <div className="work-map-plan-preview" role="table">
            <div className="work-map-plan-preview__header" role="row">
              <span role="columnheader">{t.workMapTab.planPreview.columns.scene}</span>
              <span role="columnheader">{t.workMapTab.planPreview.columns.content}</span>
              <span role="columnheader">{t.workMapTab.planPreview.columns.text}</span>
              <span role="columnheader">{t.workMapTab.planPreview.columns.duration}</span>
              <span role="columnheader">{t.workMapTab.planPreview.columns.action}</span>
            </div>
            {entries.map((entry) => {
              const assetLabel = resolveAssetLabel(entry);
              return (
                <div key={entry.id} className="work-map-plan-preview__row" role="row">
                  <span role="cell">{resolveSceneName(entry)}</span>
                  <span role="cell">{assetLabel ?? t.workMapTab.planPreview.noContent}</span>
                  <span role="cell">{entry.desiredText ?? t.workMapTab.planPreview.noContent}</span>
                  <span role="cell">{entry.desiredDurationSeconds !== null ? `${entry.desiredDurationSeconds}s` : t.workMapTab.planPreview.noContent}</span>
                  <span role="cell">
                    <Button size="sm" variant="ghost" onClick={() => setViewMode("manualForm")}>
                      {t.workMapTab.planPreview.editAction}
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <details className="advanced-details">
          <summary>{t.workMapTab.planPreview.advancedDetailsToggle}</summary>
          <ul className="advanced-details__list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <code>{entry.id}</code> · {t.workMapTab.fields.sourceCompositionId}: <code>{entry.sourceCompositionId ?? "null"}</code> ·{" "}
                {t.workMapTab.fields.desiredAssetId}: <code>{entry.desiredAssetId ?? "null"}</code>
              </li>
            ))}
          </ul>
        </details>
        <div className="edit-drawer-actions">
          <Button variant="secondary" onClick={() => setViewMode("tellAi")}>
            {t.workMapTab.planPreview.tellAiAgainAction}
          </Button>
          <Button variant="secondary" onClick={() => setViewMode("manualForm")}>
            {t.workMapTab.ai.addDetailsManually}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title={t.workMapTab.title} />
      <p>{t.workMapTab.description}</p>
      <p className="work-map-intro">{t.workMapTab.intro}</p>
      {saveError ? <ErrorState title={t.workMapTab.saveFailedTitle} description={saveError} /> : null}

      {rows.length === 0 ? (
        <EmptyState title={t.workMapTab.emptyTitle} description={t.workMapTab.emptyDescription} />
      ) : (
        <div className="work-map-rows">
          {rows.map((row, index) => (
            <fieldset key={row.id ?? `new-${index}`} className="work-map-row">
              <legend>{row.sourceReference || `#${index + 1}`}</legend>
              <Field label={t.workMapTab.fields.sourceReference} htmlFor={`wm-source-reference-${index}`}>
                <Input
                  id={`wm-source-reference-${index}`}
                  value={row.sourceReference}
                  onChange={(event) => updateRow(index, { sourceReference: event.target.value })}
                />
              </Field>
              <Field label={t.workMapTab.fields.sourceCompositionId} htmlFor={`wm-composition-${index}`} hint={t.workMapTab.fieldHints.sourceCompositionId}>
                <Select
                  id={`wm-composition-${index}`}
                  value={row.sourceCompositionId}
                  onChange={(event) => updateRow(index, { sourceCompositionId: event.target.value })}
                >
                  <option value="">{t.workMapTab.picker.sceneNoneOption}</option>
                  {project.manifest.compositions.map((composition) => (
                    <option key={composition.compositionId} value={composition.compositionId}>
                      {composition.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.workMapTab.fields.desiredAssetId} htmlFor={`wm-asset-${index}`} hint={t.workMapTab.fieldHints.desiredAssetId}>
                <Select id={`wm-asset-${index}`} value={row.desiredAssetId} onChange={(event) => updateRow(index, { desiredAssetId: event.target.value })}>
                  <option value="">{t.workMapTab.picker.assetNoneOption}</option>
                  {(assets ?? []).map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.label ?? asset.originalFilename}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.workMapTab.fields.desiredText} htmlFor={`wm-text-${index}`}>
                <Input id={`wm-text-${index}`} value={row.desiredText} onChange={(event) => updateRow(index, { desiredText: event.target.value })} />
              </Field>
              <Field label={t.workMapTab.fields.assetTimestampSeconds} htmlFor={`wm-timestamp-${index}`}>
                <Input
                  id={`wm-timestamp-${index}`}
                  type="number"
                  min="0"
                  step="0.1"
                  value={row.assetTimestampSeconds}
                  onChange={(event) => updateRow(index, { assetTimestampSeconds: event.target.value })}
                />
              </Field>
              <Field label={t.workMapTab.fields.desiredDurationSeconds} htmlFor={`wm-duration-${index}`}>
                <Input
                  id={`wm-duration-${index}`}
                  type="number"
                  min="0"
                  step="0.1"
                  value={row.desiredDurationSeconds}
                  onChange={(event) => updateRow(index, { desiredDurationSeconds: event.target.value })}
                />
              </Field>
              <Field label={t.workMapTab.fields.instructions} htmlFor={`wm-instructions-${index}`}>
                <textarea
                  id={`wm-instructions-${index}`}
                  className="input"
                  rows={2}
                  value={row.instructions}
                  onChange={(event) => updateRow(index, { instructions: event.target.value })}
                />
              </Field>
              <Button size="sm" variant="ghost" onClick={() => removeRow(index)}>
                {t.workMapTab.removeRow}
              </Button>
            </fieldset>
          ))}
        </div>
      )}

      <div className="edit-drawer-actions">
        <Button variant="ghost" onClick={() => setViewMode(hasEnteredPreviewOnce ? "planPreview" : "tellAi")}>
          {t.workMapTab.picker.backToSimpleView}
        </Button>
        <Button variant="secondary" onClick={addRow}>
          {t.workMapTab.addRow}
        </Button>
        <Button variant="primary" disabled={isSaving} onClick={() => void handleSave()}>
          {isSaving ? t.workMapTab.saving : t.workMapTab.save}
        </Button>
      </div>
    </Card>
  );
}
