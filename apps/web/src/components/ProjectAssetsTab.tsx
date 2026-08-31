"use client";

import { useRef, useState, type FormEvent, type ReactElement } from "react";
import { Trash2 } from "lucide-react";
import type { AssetDto, MediaKind } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useProjectAssets } from "../lib/use-project-assets";
import { assetFileUrl } from "../lib/projects-api-client";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Dialog } from "./ui/Dialog";
import { Skeleton } from "./ui/Skeleton";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { useLocale } from "./LocaleProvider";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const PREVIEWABLE_KINDS: MediaKind[] = ["IMAGE", "LOGO"];

export function ProjectAssetsTab(): ReactElement | null {
  const { project } = useProjectWorkspaceContext();

  if (!project) {
    return null;
  }

  return <AssetsPanel projectId={project.project.projectId} />;
}

function AssetsPanel({ projectId }: { projectId: string }): ReactElement {
  const { t } = useLocale();
  const { assets, isLoading, error, upload, update, remove } = useProjectAssets(projectId);
  const [uploadMediaKind, setUploadMediaKind] = useState<"" | "LOGO">("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleUploadSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      return;
    }
    setIsUploading(true);
    setUploadError(null);
    const result = await upload(file, uploadMediaKind === "LOGO" ? "LOGO" : undefined);
    setIsUploading(false);
    if (result.ok) {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setUploadMediaKind("");
    } else {
      setUploadError(result.message);
    }
  }

  return (
    <>
      <Card>
        <CardHeader title={t.assetsTab.uploadTitle} />
        <form className="asset-upload-form" onSubmit={(event) => void handleUploadSubmit(event)}>
          {uploadError ? <ErrorState title={t.assetsTab.uploadFailedTitle} description={uploadError} /> : null}
          <Field label={t.assetsTab.fileLabel} htmlFor="asset-file-input">
            <input ref={fileInputRef} id="asset-file-input" type="file" className="input" disabled={isUploading} />
          </Field>
          <Field
            label={t.assetsTab.mediaKindLabel}
            htmlFor="asset-media-kind"
            {...(uploadMediaKind === "LOGO" ? { hint: t.assetsTab.mediaKindLogoHint } : {})}
          >
            <Select
              id="asset-media-kind"
              value={uploadMediaKind}
              disabled={isUploading}
              onChange={(event) => setUploadMediaKind(event.target.value === "LOGO" ? "LOGO" : "")}
            >
              <option value="">{t.assetsTab.mediaKindAuto}</option>
              <option value="LOGO">{t.assetsTab.mediaKind.LOGO}</option>
            </Select>
          </Field>
          <Button type="submit" variant="primary" disabled={isUploading}>
            {isUploading ? t.assetsTab.uploading : t.assetsTab.uploadAction}
          </Button>
        </form>
      </Card>

      <Card>
        <CardHeader title={t.assetsTab.title} />
        <p>{t.assetsTab.description}</p>
        {isLoading ? (
          <Skeleton height="1.5rem" />
        ) : error ? (
          <ErrorState title={t.projectWorkspace.loadErrorTitle} description={error} />
        ) : !assets || assets.length === 0 ? (
          <EmptyState title={t.assetsTab.emptyTitle} description={t.assetsTab.emptyDescription} />
        ) : (
          <div className="asset-grid">
            {assets.map((asset) => (
              <AssetCard
                key={asset.id}
                projectId={projectId}
                asset={asset}
                onSaveDetails={(body) => update(asset.id, body)}
                onDelete={() => remove(asset.id)}
              />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function AssetCard({
  projectId,
  asset,
  onSaveDetails,
  onDelete
}: {
  projectId: string;
  asset: AssetDto;
  onSaveDetails: (body: { label?: string | null; notes?: string | null }) => Promise<{ ok: boolean; message?: string }>;
  onDelete: () => Promise<{ ok: boolean; message?: string }>;
}): ReactElement {
  const { t } = useLocale();
  const [label, setLabel] = useState(asset.label ?? "");
  const [notes, setNotes] = useState(asset.notes ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function handleSaveDetails(): Promise<void> {
    setIsSaving(true);
    setSaveError(null);
    const result = await onSaveDetails({
      label: label.trim() === "" ? null : label.trim(),
      notes: notes.trim() === "" ? null : notes.trim()
    });
    setIsSaving(false);
    if (!result.ok) {
      setSaveError(result.message ?? null);
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    setIsDeleting(true);
    setDeleteError(null);
    const result = await onDelete();
    setIsDeleting(false);
    if (result.ok) {
      setConfirmingDelete(false);
    } else {
      setDeleteError(result.message ?? null);
    }
  }

  return (
    <div className="asset-card">
      <div className="asset-card__thumb">
        {PREVIEWABLE_KINDS.includes(asset.mediaKind) ? (
          <img src={assetFileUrl(projectId, asset.id)} alt={asset.label ?? asset.originalFilename} />
        ) : (
          <span className="asset-card__kind-badge">{t.assetsTab.mediaKind[asset.mediaKind]}</span>
        )}
      </div>
      <div className="asset-card__meta">
        <p className="asset-card__filename">{asset.originalFilename}</p>
        <dl className="asset-card__facts">
          <div>
            <dt>{t.assetsTab.sizeLabel}</dt>
            <dd>{formatBytes(asset.byteSize)}</dd>
          </div>
          <div>
            <dt>{t.assetsTab.uploadedLabel}</dt>
            <dd>{new Date(asset.uploadedAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>{t.assetsTab.shaLabel}</dt>
            <dd>
              <code>{asset.sha256.slice(0, 12)}</code>
            </dd>
          </div>
        </dl>
        {saveError ? <ErrorState title={t.projectWorkspace.saveFailedTitle} description={saveError} /> : null}
        <Field label={t.assetsTab.labelLabel} htmlFor={`asset-label-${asset.id}`}>
          <Input
            id={`asset-label-${asset.id}`}
            value={label}
            placeholder={t.assetsTab.labelPlaceholder}
            disabled={isSaving}
            onChange={(event) => setLabel(event.target.value)}
          />
        </Field>
        <Field label={t.assetsTab.notesLabel} htmlFor={`asset-notes-${asset.id}`}>
          <Input
            id={`asset-notes-${asset.id}`}
            value={notes}
            placeholder={t.assetsTab.notesPlaceholder}
            disabled={isSaving}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
        <div className="asset-card__actions">
          <Button size="sm" variant="secondary" disabled={isSaving} onClick={() => void handleSaveDetails()}>
            {isSaving ? t.assetsTab.savingDetails : t.assetsTab.saveDetails}
          </Button>
          <Button size="sm" variant="danger" onClick={() => setConfirmingDelete(true)}>
            <Trash2 aria-hidden="true" />
            {t.assetsTab.deleteAction}
          </Button>
        </div>
      </div>

      <Dialog open={confirmingDelete} onClose={() => setConfirmingDelete(false)} title={t.assetsTab.deleteConfirmTitle} variant="modal">
        <p>{t.assetsTab.deleteConfirmDescription(asset.originalFilename)}</p>
        {deleteError ? <ErrorState title={t.assetsTab.deleteFailedTitle} description={deleteError} /> : null}
        <div className="edit-drawer-actions">
          <Button variant="ghost" disabled={isDeleting} onClick={() => setConfirmingDelete(false)}>
            {t.assetsTab.deleteCancelAction}
          </Button>
          <Button variant="danger" disabled={isDeleting} onClick={() => void handleConfirmDelete()}>
            <Trash2 aria-hidden="true" />
            {t.assetsTab.deleteConfirmAction}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
