"use client";

import type { ReactElement } from "react";
import type { AssetDto, MappingSuggestion } from "@dyo/schemas";
import type { RealScene } from "../lib/real-scene-grouping";
import type { ScenePreviewEntry, ScenePreviewState } from "../lib/use-scene-preview-queue";
import { assetFileUrl, sceneEvidencePreviewFileUrl } from "../lib/projects-api-client";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { useLocale } from "./LocaleProvider";
import type { Tone } from "./StatusBadge";

type CardStatus = "ready" | "needsChoice" | "analyzing" | "generating" | "outdated";

const STATUS_TONE: Record<CardStatus, Tone> = {
  ready: "positive",
  needsChoice: "info",
  analyzing: "neutral",
  generating: "neutral",
  outdated: "negative"
};

function deriveCardStatus(
  hasGenuineReview: boolean,
  previewState: ScenePreviewState,
  isStale: boolean,
  approvalState: RealScene["scenePlan"]["approvalState"]
): CardStatus {
  if (hasGenuineReview) {
    return "needsChoice";
  }
  if (previewState === "checking" || previewState === "queued") {
    return "analyzing";
  }
  if (previewState === "generating") {
    return "generating";
  }
  if (isStale) {
    return "outdated";
  }
  return approvalState === "READY_FOR_APPROVAL" || approvalState === "APPROVED" ? "ready" : "needsChoice";
}

function primaryMapping(realScene: RealScene) {
  return realScene.scenePlan.mappings.find((m) => m.selectedAssetId || m.text) ?? realScene.scenePlan.mappings[0] ?? null;
}

/**
 * "M. VISUAL PREVIEWS ARE MANDATORY", point 4/11: shows Original (a real
 * AE-captured frame) alongside Planned (an honestly-labeled browser
 * mockup built from the currently assigned asset/text) side by side when
 * BOTH exist - never presenting the mockup as if it were the real AE
 * result. Falls back to whichever ONE of the two actually exists, and to
 * a plain empty state when neither does yet.
 */
function PreviewBeforeAfter({
  projectId,
  realScene,
  previewEntry,
  asset,
  mappingText
}: {
  projectId: string;
  realScene: RealScene;
  previewEntry: ScenePreviewEntry;
  asset: AssetDto | null;
  mappingText: string | null;
}): ReactElement {
  const { t } = useLocale();
  const hasOriginal = previewEntry.preview !== null;
  const hasPlanned = asset !== null || mappingText !== null;

  if (!hasOriginal && !hasPlanned) {
    return (
      <div className="scene-card__preview">
        <p className="scene-card__preview-empty">{t.simpleScenes.noPreviewYetHint}</p>
      </div>
    );
  }

  return (
    <div className="scene-card__preview scene-card__preview--split" data-split={hasOriginal && hasPlanned}>
      {hasOriginal ? (
        <div className="scene-card__preview-pane">
          <img src={sceneEvidencePreviewFileUrl(projectId, realScene.scenePlan.id)} alt={realScene.sceneName} className="scene-card__preview-media" />
          <span className="scene-card__preview-badge">{t.simpleScenes.aePreviewLabel}</span>
          {previewEntry.isStale ? <p className="scene-card__preview-hint">{t.simpleScenes.outdatedPreviewHint}</p> : null}
        </div>
      ) : null}
      {hasPlanned ? (
        <div className="scene-card__preview-pane">
          {asset ? (
            asset.mediaKind === "VIDEO" ? (
              <video src={assetFileUrl(projectId, asset.id)} className="scene-card__preview-media" muted />
            ) : (
              <img src={assetFileUrl(projectId, asset.id)} alt={realScene.sceneName} className="scene-card__preview-media" />
            )
          ) : null}
          {mappingText ? <p className="scene-card__preview-caption">{mappingText}</p> : null}
          <span className="scene-card__preview-badge scene-card__preview-badge--planned">{t.simpleScenes.plannedPreviewLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

export interface SceneCardProps {
  projectId: string;
  realScene: RealScene;
  assets: AssetDto[] | null;
  previewEntry: ScenePreviewEntry;
  pendingSuggestions: MappingSuggestion[];
  suggestionsBusy: boolean;
  onEdit: () => void;
  onRegeneratePreview: () => void;
  onAcceptSuggestion: (suggestion: MappingSuggestion) => void;
  onRejectSuggestion: (suggestion: MappingSuggestion) => void;
}

/**
 * One real, user-facing scene card (client-facing UX redesign, section
 * B/C + "M. VISUAL PREVIEWS ARE MANDATORY" + the "LIVE UX ACCEPTANCE
 * FAILED" section 6 follow-up). Never shows a raw AE layer name,
 * confidence percentage, or Worker job name in this Simple Mode view.
 * Preview generation is automatic (see use-scene-preview-queue.ts, owned
 * by the parent SimpleScenesView) - this card never dispatches on its
 * own; "Regenerate Preview" (Advanced details only) is the one manual
 * escape hatch, for a failed or stale preview.
 */
export function SceneCard({
  projectId,
  realScene,
  assets,
  previewEntry,
  pendingSuggestions,
  suggestionsBusy,
  onEdit,
  onRegeneratePreview,
  onAcceptSuggestion,
  onRejectSuggestion
}: SceneCardProps): ReactElement {
  const { t } = useLocale();
  const mapping = primaryMapping(realScene);
  const asset = mapping?.selectedAssetId ? ((assets ?? []).find((a) => a.id === mapping.selectedAssetId) ?? null) : null;
  const hasGenuineReview = pendingSuggestions.length > 0;
  const status = deriveCardStatus(hasGenuineReview, previewEntry.state, previewEntry.isStale, realScene.scenePlan.approvalState);
  const canRegenerate = previewEntry.state === "idle" || previewEntry.state === "ready" || previewEntry.state === "unavailable";

  return (
    <Card className="scene-card">
      <div className="scene-card__header">
        <h3>{realScene.sceneName}</h3>
        <span className={`status-badge status-badge--${STATUS_TONE[status]}`}>{t.simpleScenes.status[status]}</span>
      </div>

      <PreviewBeforeAfter projectId={projectId} realScene={realScene} previewEntry={previewEntry} asset={asset} mappingText={mapping?.text ?? null} />

      <dl className="scene-card__facts">
        <div>
          <dt>{t.simpleScenes.screenLabel}</dt>
          <dd>{asset ? (asset.label ?? asset.originalFilename) : t.simpleScenes.noAssetAssigned}</dd>
        </div>
        <div>
          <dt>{t.simpleScenes.textLabel}</dt>
          <dd>{mapping?.text ?? t.simpleScenes.noTextLabel}</dd>
        </div>
        <div>
          <dt>{t.simpleScenes.durationLabel}</dt>
          <dd>
            {realScene.scenePlan.finalDuration !== null ? t.simpleScenes.durationSeconds(realScene.scenePlan.finalDuration) : t.simpleScenes.durationUnset}
          </dd>
        </div>
      </dl>

      {previewEntry.errorMessage ? (
        <p className="scene-card__error">
          {t.simpleScenes.previewErrorPrefix} {previewEntry.errorMessage}
        </p>
      ) : null}

      <div className="scene-card__actions">
        <Button size="sm" variant="ghost" onClick={onEdit}>
          {t.simpleScenes.editAction}
        </Button>
      </div>

      {hasGenuineReview ? (
        <div className="scene-card__review-queue">
          <h4>{t.simpleScenes.reviewQueueTitle}</h4>
          {pendingSuggestions.map((suggestion) => {
            const suggestedAsset = suggestion.suggestedAssetId ? ((assets ?? []).find((a) => a.id === suggestion.suggestedAssetId) ?? null) : null;
            return (
              <div key={suggestion.id} className="scene-card__review-item">
                {suggestion.suggestedText ? (
                  <>
                    <p className="scene-card__review-current">{t.simpleScenes.currentTextLabel(mapping?.text ?? "")}</p>
                    <p className="scene-card__review-suggested">{t.simpleScenes.suggestedTextLabel(suggestion.suggestedText)}</p>
                  </>
                ) : suggestedAsset ? (
                  suggestedAsset.mediaKind === "VIDEO" ? (
                    <video src={assetFileUrl(projectId, suggestedAsset.id)} className="scene-card__review-thumb" muted />
                  ) : (
                    <img src={assetFileUrl(projectId, suggestedAsset.id)} alt="" className="scene-card__review-thumb" />
                  )
                ) : null}
                <div className="scene-card__review-actions">
                  <Button size="sm" variant="ghost" disabled={suggestionsBusy} onClick={() => onRejectSuggestion(suggestion)}>
                    {t.simpleScenes.keepOriginalAction}
                  </Button>
                  <Button size="sm" variant="primary" disabled={suggestionsBusy} onClick={() => onAcceptSuggestion(suggestion)}>
                    {t.simpleScenes.useSuggestionAction}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <details className="advanced-details">
        <summary>{t.simpleScenes.advancedDetailsToggle}</summary>
        <dl className="scene-card__advanced-facts">
          <div>
            <dt>Composition ID</dt>
            <dd>{realScene.manifestCompositionId}</dd>
          </div>
          {realScene.nested.length > 0 ? (
            <div>
              <dt>Nested compositions</dt>
              <dd>{realScene.nested.map((n) => n.compositionName).join(", ")}</dd>
            </div>
          ) : null}
        </dl>
        <Button size="sm" variant="secondary" disabled={!canRegenerate} onClick={onRegeneratePreview}>
          {t.simpleScenes.regeneratePreviewAction}
        </Button>
      </details>
    </Card>
  );
}
