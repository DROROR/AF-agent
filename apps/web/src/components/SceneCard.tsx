"use client";

import type { ReactElement } from "react";
import type { AssetDto, MappingSuggestion, PlaceholderMapping } from "@dyo/schemas";
import type { RealScene } from "../lib/real-scene-grouping";
import type { ScenePreviewEntry, ScenePreviewState } from "../lib/use-scene-preview-queue";
import { assetFileUrl, sceneEvidencePreviewFileUrl } from "../lib/projects-api-client";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { useLocale } from "./LocaleProvider";
import type { Tone } from "./StatusBadge";

type CardStatus = "ready" | "needsChoice" | "noChangeNeeded" | "analyzing" | "generating" | "outdated";

const STATUS_TONE: Record<CardStatus, Tone> = {
  ready: "positive",
  needsChoice: "info",
  noChangeNeeded: "positive",
  analyzing: "neutral",
  generating: "neutral",
  outdated: "negative"
};

/**
 * `hasNoMappingsToReview` distinguishes a scene that is resolved because it
 * genuinely has nothing editable (zero placeholders/mappings - the
 * approved AI plan's own "keep original" intent, see
 * compute-scene-unresolved-reasons.ts's isStructurallyResolvedWithNoMappings)
 * from a scene resolved because a real content decision was actually made.
 * Both reach approvalState READY_FOR_APPROVAL/APPROVED, but only the first
 * is a "noChangeNeeded" scene - the second is a genuine "ready" scene with
 * a real mapping behind it (live QA Blocker 3 fix, 2026-09-07). A scene
 * still stuck UNREVIEWED because of a genuine evidence/inspection FAILURE
 * (never cleared by that same fix) still falls through to "needsChoice"
 * here, unchanged - it is not resolved, so it must not look resolved.
 */
function deriveCardStatus(
  hasGenuineReview: boolean,
  previewState: ScenePreviewState,
  isStale: boolean,
  approvalState: RealScene["scenePlan"]["approvalState"],
  hasNoMappingsToReview: boolean
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
  if (approvalState !== "READY_FOR_APPROVAL" && approvalState !== "APPROVED") {
    return "needsChoice";
  }
  return hasNoMappingsToReview ? "noChangeNeeded" : "ready";
}

// function primaryMapping(realScene: RealScene) {
//   return realScene.scenePlan.mappings.find((m) => m.selectedAssetId || m.text) ?? realScene.scenePlan.mappings[0] ?? null;
// }
function primaryMapping(mappings: readonly PlaceholderMapping[]) {
  return mappings.find((m) => m.selectedAssetId || m.text) ?? mappings[0] ?? null;
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
  /**
   * The layers shown on THIS card - which can differ from the scene plan's
   * own mappings when a template keeps every layer under one master scene
   * (see resolveSceneMappingHomes). Absent: the scene plan's own mappings,
   * exactly as before.
   */
  cardMappings?: readonly PlaceholderMapping[];
  /** Applies several suggestions in ONE request. Absent: no "use all" button is offered - several single accepts fired together would each carry the same plan revision and all but the first would be refused as stale. */
  onAcceptSuggestions?: (suggestions: MappingSuggestion[]) => void;
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
  onRejectSuggestion,
  cardMappings,
  onAcceptSuggestions
}: SceneCardProps): ReactElement {
  const { t } = useLocale();
  const shownMappings = cardMappings ?? realScene.scenePlan.mappings;
  // const mapping = primaryMapping(realScene);
  const mapping = primaryMapping(shownMappings);
  const asset = mapping?.selectedAssetId ? ((assets ?? []).find((a) => a.id === mapping.selectedAssetId) ?? null) : null;
  // 2026-09-28, real client session: a 77-composition template surfaced 30
  // structural layers (a border overlay, a "Sharpen" adjustment layer, a
  // black fade solid) as editable placeholders. Claude examined each, said in
  // its reasoning that none is a content slot, and returned a suggestion
  // carrying NO text, NO asset and NO classification - it proposes nothing.
  //
  // This card rendered each of those as a review item anyway: thirty
  // identical pairs of blank "Keep original / Use suggestion" buttons in one
  // scene, with the reasoning that explains them stored but never shown. A
  // decision with nothing to decide is not a decision, and thirty of them is
  // not a review queue.
  //
  // A suggestion now reaches the queue only when it actually proposes
  // something. The rest are reported as what they are - findings, with the
  // reasoning visible - and still individually actionable, so nothing is
  // hidden or applied on the operator's behalf.
  const proposals = pendingSuggestions.filter(
    (s) => s.suggestedText !== null || s.suggestedAssetId !== null || s.suggestedClassification !== null
  );
  const findings = pendingSuggestions.filter(
    (s) => s.suggestedText === null && s.suggestedAssetId === null && s.suggestedClassification === null
  );
  const hasGenuineReview = proposals.length > 0;
  // const hasNoMappingsToReview = realScene.scenePlan.mappings.length === 0;
  const hasNoMappingsToReview = shownMappings.length === 0;
  const status = deriveCardStatus(hasGenuineReview, previewEntry.state, previewEntry.isStale, realScene.scenePlan.approvalState, hasNoMappingsToReview);
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
          <dd>{asset ? (asset.label ?? asset.originalFilename) : status === "noChangeNeeded" ? t.simpleScenes.originalContentKept : t.simpleScenes.noAssetAssigned}</dd>
        </div>
        <div>
          <dt>{t.simpleScenes.textLabel}</dt>
          <dd>{mapping?.text ?? (status === "noChangeNeeded" ? t.simpleScenes.originalTextPreserved : t.simpleScenes.noTextLabel)}</dd>
        </div>
        <div>
          <dt>{t.simpleScenes.durationLabel}</dt>
          <dd>
            {realScene.scenePlan.finalDuration !== null
              ? t.simpleScenes.durationSeconds(realScene.scenePlan.finalDuration)
              : status === "noChangeNeeded"
                ? t.simpleScenes.originalTimingPreserved
                : t.simpleScenes.durationUnset}
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
          {/* One press for the whole card - several suggestions each with their own pair of buttons is slow to get through. */}
          {proposals.length > 1 && onAcceptSuggestions ? (
            <Button size="sm" variant="primary" disabled={suggestionsBusy} onClick={() => onAcceptSuggestions(proposals)}>
              {t.simpleScenes.useAllSuggestionsAction(proposals.length)}
            </Button>
          ) : null}
          {proposals.map((suggestion) => {
            const suggestedAsset = suggestion.suggestedAssetId ? ((assets ?? []).find((a) => a.id === suggestion.suggestedAssetId) ?? null) : null;
            // The layer THIS suggestion is for. Was always the card's first
            // mapping, so every suggestion showed the same "currently" text
            // and none said which layer it meant.
            const target = shownMappings.find((m) => m.id === suggestion.mappingId) ?? null;
            return (
              <div key={suggestion.id} className="scene-card__review-item">
                {target?.placeholderName ? <p className="scene-card__review-layer">{target.placeholderName}</p> : null}
                {suggestion.suggestedText ? (
                  <>
                    {/* <p className="scene-card__review-current">{t.simpleScenes.currentTextLabel(mapping?.text ?? "")}</p> */}
                    {target?.text ? <p className="scene-card__review-current">{t.simpleScenes.currentTextLabel(target.text)}</p> : null}
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

      {findings.length > 0 ? (
        <details className="scene-card__findings">
          <summary>{t.simpleScenes.findingsTitle(findings.length)}</summary>
          <p className="scene-card__findings-description">{t.simpleScenes.findingsDescription}</p>
          {findings.map((finding) => (
            <div key={finding.id} className="scene-card__finding">
              {(() => {
                // The layer's own name lives on the mapping this suggestion
                // is about, never on the suggestion itself. Omitted rather
                // than invented when the mapping cannot be found.
                const named = shownMappings.find((m) => m.id === finding.mappingId);
                return named?.placeholderName ? <p className="scene-card__finding-layer">{t.simpleScenes.findingsLayerLabel(named.placeholderName)}</p> : null;
              })()}
              <p className="scene-card__finding-reason">{finding.reasoning ?? t.simpleScenes.findingsNoReason}</p>
            </div>
          ))}
          {/*
            ONE action for the whole set, not one per finding - a button per
            item is exactly the wall this block exists to remove.
            It is still required: an unresolved suggestion keeps the scene out
            of `reviewsReady`, so leaving thirty of them pending would disable
            Approve Scenes forever with no way to clear them.
          */}
          <Button
            size="sm"
            variant="ghost"
            disabled={suggestionsBusy}
            onClick={() => findings.forEach((finding) => onAcceptSuggestion(finding))}
          >
            {t.simpleScenes.findingsAcceptAllAction(findings.length)}
          </Button>
        </details>
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
