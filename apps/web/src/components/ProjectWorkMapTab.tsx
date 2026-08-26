"use client";

import { useEffect, useState, type ReactElement } from "react";
import type { WorkMapEntry } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useWorkMap } from "../lib/use-work-map";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
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

  return <WorkMapPanel projectId={project.project.projectId} />;
}

function WorkMapPanel({ projectId }: { projectId: string }): ReactElement {
  const { t } = useLocale();
  const { workMap, isLoading, error, isStale, refetch, save } = useWorkMap(projectId);
  const [rows, setRows] = useState<RowForm[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    // Synchronizes local editable rows from the real work map whenever it
    // (re)loads - same "derive editable state from an external value"
    // pattern as SceneEditDrawer.tsx's own effect, exempt from
    // react-hooks/set-state-in-effect for the same reason.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(workMap ? workMap.entries.map(toRowForm) : []);
  }, [workMap]);

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
    if (!result.ok) {
      setSaveError(result.message ?? null);
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

  return (
    <Card>
      <CardHeader title={t.workMapTab.title} />
      <p>{t.workMapTab.description}</p>
      <p className="work-map-intro">{t.workMapTab.intro}</p>

      {isStale ? (
        <>
          <ErrorState title={t.projectWorkspace.staleRevisionTitle} description={t.projectWorkspace.staleRevisionDescription} />
          <Button variant="secondary" size="sm" onClick={() => void refetch()}>
            {t.projectWorkspace.reload}
          </Button>
        </>
      ) : null}
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
              <Field
                label={t.workMapTab.fields.sourceCompositionId}
                htmlFor={`wm-composition-${index}`}
                hint={t.workMapTab.fieldHints.sourceCompositionId}
              >
                <Input
                  id={`wm-composition-${index}`}
                  value={row.sourceCompositionId}
                  onChange={(event) => updateRow(index, { sourceCompositionId: event.target.value })}
                />
              </Field>
              <Field
                label={t.workMapTab.fields.desiredAssetId}
                htmlFor={`wm-asset-${index}`}
                hint={t.workMapTab.fieldHints.desiredAssetId}
              >
                <Input
                  id={`wm-asset-${index}`}
                  value={row.desiredAssetId}
                  onChange={(event) => updateRow(index, { desiredAssetId: event.target.value })}
                />
              </Field>
              <Field label={t.workMapTab.fields.desiredText} htmlFor={`wm-text-${index}`}>
                <Input
                  id={`wm-text-${index}`}
                  value={row.desiredText}
                  onChange={(event) => updateRow(index, { desiredText: event.target.value })}
                />
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
