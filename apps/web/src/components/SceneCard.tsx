"use client";

import type { ReactElement } from "react";
import type { AssetDto, MappingSuggestion, WorkerDto } from "@dyo/schemas";
import type { RealScene } from "../lib/real-scene-grouping";
import { useScenePreview, type ScenePreviewState, type UseScenePreviewResult } from "../lib/use-scene-preview";
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
  if (previewState === "checking") {
    return "analyzing";
  }
  if (previewState === "generating") {
    return "generating";
  }
  if (isStale) {
    return "outdated";
  }
  return approvalState === "READY_FOR_APPROVAL" || approvalState === "APPROVED"
    ? "ready"
    : "needsChoice";
}

function primaryMapping(realScene: RealScene) {
  return (
    realScene.scenePlan.mappings.find((m) => m.selectedAssetId || m.text) ??
    realScene.scenePlan.mappings[0] ??
    null
  );
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
  scenePreview,
  asset,
  mappingText
}: {
  projectId: string;
  realScene: RealScene;
  scenePreview: UseScenePreviewResult;
  asset: AssetDto | null;
  mappingText: string | null;
}): ReactElement {
  const { t } = useLocale();
  const hasOriginal = scenePreview.preview !== null;
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
          <img
            src={sceneEvidencePreviewFileUrl(projectId, realScene.scenePlan.id)}
            alt={realScene.sceneName}
            className="scene-card__preview-media"
          />
          <span className="scene-card__preview-badge">{t.simpleScenes.aePreviewLabel}</span>
          {scenePreview.isStale ? <p className="scene-card__preview-hint">{t.simpleScenes.outdatedPreviewHint}</p> : null}
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
  workers: WorkerDto[] | null;
  pendingSuggestions: MappingSuggestion[];
  suggestionsBusy: boolean;
  onEdit: () => void;
  onAcceptSuggestion: (suggestion: MappingSuggestion) => void;
  onRejectSuggestion: (suggestion: MappingSuggestion) => void;
}

/**
 * One real, user-facing scene card (client-facing UX redesign, section B/C
 * + "M. VISUAL PREVIEWS ARE MANDATORY"). Never shows a raw AE layer name,
 * confidence percentage, or Worker job name in this Simple Mode view - see
 * useScenePreview.ts for the simple client-facing preview state machine.
 */
export function SceneCard({
  projectId,
  realScene,
  assets,
  workers,
  pendingSuggestions,
  suggestionsBusy,
  onEdit,
  onAcceptSuggestion,
  onRejectSuggestion
}: SceneCardProps): ReactElement {
  const { t } = useLocale();
  const scenePreview = useScenePreview(
    projectId,
    realScene.scenePlan.id,
    realScene.scenePlan.updatedAt,
    workers
  );
  const mapping = primaryMapping(realScene);
  const asset = mapping?.selectedAssetId
    ? ((assets ?? []).find((a) => a.id === mapping.selectedAssetId) ?? null)
    : null;
  const hasGenuineReview = pendingSuggestions.length > 0;
  const status = deriveCardStatus(
    hasGenuineReview,
    scenePreview.state,
    scenePreview.isStale,
    realScene.scenePlan.approvalState
  );

  return (
    <Card className="scene-card">
      <div className="scene-card__header">
        <h3>{realScene.sceneName}</h3>
        <span className={`status-badge status-badge--${STATUS_TONE[status]}`}>
          {t.simpleScenes.status[status]}
        </span>
      </div>

      <PreviewBeforeAfter projectId={projectId} realScene={realScene} scenePreview={scenePreview} asset={asset} mappingText={mapping?.text ?? null} />

      <dl className="scene-card__facts">
        <div>
          <dt>{t.simpleScenes.screenLabel}</dt>
          <dd>
            {asset ? (asset.label ?? asset.originalFilename) : t.simpleScenes.noAssetAssigned}
          </dd>
        </div>
        <div>
          <dt>{t.simpleScenes.textLabel}</dt>
          <dd>{mapping?.text ?? t.simpleScenes.noTextLabel}</dd>
        </div>
        <div>
          <dt>{t.simpleScenes.durationLabel}</dt>
          <dd>
            {realScene.scenePlan.finalDuration !== null
              ? t.simpleScenes.durationSeconds(realScene.scenePlan.finalDuration)
              : t.simpleScenes.durationUnset}
          </dd>
        </div>
      </dl>

      {scenePreview.errorMessage ? (
        <p className="scene-card__error">
          {t.simpleScenes.previewErrorPrefix} {scenePreview.errorMessage}
        </p>
      ) : null}

      <div className="scene-card__actions">
        <Button
          size="sm"
          variant="secondary"
          disabled={scenePreview.state === "generating"}
          onClick={() => scenePreview.requestPreview()}
        >
          {scenePreview.state === "generating"
            ? t.simpleScenes.generatingPreviewAction
            : t.simpleScenes.previewSceneAction}
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          {t.simpleScenes.editAction}
        </Button>
      </div>

      {hasGenuineReview ? (
        <div className="scene-card__review-queue">
          <h4>{t.simpleScenes.reviewQueueTitle}</h4>
          {pendingSuggestions.map((suggestion) => {
            const suggestedAsset = suggestion.suggestedAssetId
              ? ((assets ?? []).find((a) => a.id === suggestion.suggestedAssetId) ?? null)
              : null;
            return (
              <div key={suggestion.id} className="scene-card__review-item">
                {suggestion.suggestedText ? (
                  <>
                    <p className="scene-card__review-current">
                      {t.simpleScenes.currentTextLabel(mapping?.text ?? "")}
                    </p>
                    <p className="scene-card__review-suggested">
                      {t.simpleScenes.suggestedTextLabel(suggestion.suggestedText)}
                    </p>
                  </>
                ) : suggestedAsset ? (
                  suggestedAsset.mediaKind === "VIDEO" ? (
                    <video
                      src={assetFileUrl(projectId, suggestedAsset.id)}
                      className="scene-card__review-thumb"
                      muted
                    />
                  ) : (
                    <img
                      src={assetFileUrl(projectId, suggestedAsset.id)}
                      alt=""
                      className="scene-card__review-thumb"
                    />
                  )
                ) : null}
                <div className="scene-card__review-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={suggestionsBusy}
                    onClick={() => onRejectSuggestion(suggestion)}
                  >
                    {t.simpleScenes.keepOriginalAction}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={suggestionsBusy}
                    onClick={() => onAcceptSuggestion(suggestion)}
                  >
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
      </details>
    </Card>
  );
}
