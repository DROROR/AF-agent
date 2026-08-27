"use client";

import { useState, type ReactElement } from "react";
import type { EvidenceRef, MappingSuggestion, SceneEvidenceStatus, SuggestionSource } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useMappingSuggestions } from "../lib/use-mapping-suggestions";
import { useProjectAssets } from "../lib/use-project-assets";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { Skeleton } from "./ui/Skeleton";
import { useLocale } from "./LocaleProvider";
import type { Tone } from "./StatusBadge";

function formatSeconds(value: number | null): string | null {
  if (value === null) return null;
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

const SOURCE_TONE: Record<SuggestionSource, Tone> = { DETERMINISTIC: "neutral", AI: "info" };
const EVIDENCE_TONE: Record<EvidenceRef["kind"], Tone> = { FACT: "neutral", USER_INTENT: "info", AI_INFERENCE: "positive" };
const SCENE_EVIDENCE_TONE: Record<SceneEvidenceStatus, Tone> = { AVAILABLE: "positive", STALE: "negative", NOT_INSPECTED: "neutral" };

export function MappingAssistantPanel(): ReactElement | null {
  const { t } = useLocale();
  const { project, plan, refetch } = useProjectWorkspaceContext();
  const { suggestions, aiAvailable, sceneEvidenceAvailability, isLoading, isGenerating, error, generate, accept, reject } =
    useMappingSuggestions(project?.project.projectId ?? "");
  const { assets } = useProjectAssets(project?.project.projectId ?? "");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null);

  if (!project || !plan) {
    return null;
  }

  const sceneById = new Map(plan.plan.scenePlans.map((scene) => [scene.id, scene]));
  const assetById = new Map((assets ?? []).map((asset) => [asset.id, asset]));

  async function handleGenerate(): Promise<void> {
    setActionError(null);
    const result = await generate();
    if (!result.ok) {
      setActionError(result.message ?? null);
    }
  }

  async function handleAccept(suggestion: MappingSuggestion): Promise<void> {
    setBusySuggestionId(suggestion.id);
    setActionError(null);
    const result = await accept(suggestion.id, plan!.plan.revision);
    setBusySuggestionId(null);
    if (!result.ok) {
      setActionError(result.message ?? null);
      return;
    }
    await refetch();
  }

  async function handleReject(suggestion: MappingSuggestion): Promise<void> {
    setBusySuggestionId(suggestion.id);
    setActionError(null);
    const result = await reject(suggestion.id);
    setBusySuggestionId(null);
    if (!result.ok) {
      setActionError(result.message ?? null);
    }
  }

  const pending = (suggestions ?? []).filter((s) => s.status === "PENDING");
  const reviewed = (suggestions ?? []).filter((s) => s.status !== "PENDING");

  return (
    <Card>
      <CardHeader
        title={t.mappingAssistant.title}
        action={
          <div className="mapping-assistant__header-actions">
            <span className={`status-badge status-badge--${aiAvailable ? "positive" : "neutral"}`}>
              {aiAvailable ? t.mappingAssistant.aiAvailable : t.mappingAssistant.aiUnavailable}
            </span>
            <Button size="sm" variant="primary" disabled={isGenerating} onClick={() => void handleGenerate()}>
              {isGenerating ? t.mappingAssistant.generating : t.mappingAssistant.generateAction}
            </Button>
          </div>
        }
      />
      <p>{t.mappingAssistant.description}</p>

      {error ? <ErrorState title={t.projectWorkspace.loadErrorTitle} description={error} /> : null}
      {actionError ? <ErrorState title={t.projectWorkspace.saveFailedTitle} description={actionError} /> : null}

      {isLoading ? (
        <Skeleton height="1.5rem" />
      ) : pending.length === 0 ? (
        <EmptyState title={t.mappingAssistant.emptyTitle} description={t.mappingAssistant.emptyDescription} />
      ) : (
        <div className="mapping-suggestion-list">
          {pending.map((suggestion) => {
            const scene = sceneById.get(suggestion.scenePlanId);
            const mapping = scene?.mappings.find((m) => m.id === suggestion.mappingId) ?? null;
            const suggestedAsset = suggestion.suggestedAssetId ? assetById.get(suggestion.suggestedAssetId) : null;
            const sceneEvidenceStatus: SceneEvidenceStatus =
              (scene && sceneEvidenceAvailability[scene.manifestCompositionId]) ?? "NOT_INSPECTED";
            return (
              <MappingSuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                sceneName={scene?.compositionName ?? suggestion.scenePlanId}
                placeholderName={mapping?.placeholderName ?? null}
                suggestedAssetLabel={suggestedAsset ? (suggestedAsset.label ?? suggestedAsset.originalFilename) : null}
                sceneEvidenceStatus={sceneEvidenceStatus}
                busy={busySuggestionId === suggestion.id}
                onAccept={() => void handleAccept(suggestion)}
                onReject={() => void handleReject(suggestion)}
              />
            );
          })}
        </div>
      )}

      {reviewed.length > 0 ? (
        <div className="mapping-suggestion-history">
          <h3>{t.mappingAssistant.historyTitle}</h3>
          <ul className="mapping-suggestion-history__list">
            {reviewed.map((suggestion) => (
              <li key={suggestion.id}>
                <span className={`status-badge status-badge--${suggestion.status === "ACCEPTED" ? "positive" : "negative"}`}>
                  {suggestion.status === "ACCEPTED" ? t.mappingAssistant.userConfirmed : t.mappingAssistant.rejectedLabel}
                </span>
                <span>{sceneById.get(suggestion.scenePlanId)?.compositionName ?? suggestion.scenePlanId}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function MappingSuggestionCard({
  suggestion,
  sceneName,
  placeholderName,
  suggestedAssetLabel,
  sceneEvidenceStatus,
  busy,
  onAccept,
  onReject
}: {
  suggestion: MappingSuggestion;
  sceneName: string;
  placeholderName: string | null;
  suggestedAssetLabel: string | null;
  sceneEvidenceStatus: SceneEvidenceStatus;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
}): ReactElement {
  const { t } = useLocale();
  const timestamp = formatSeconds(suggestion.suggestedAssetTimestamp);
  const duration = formatSeconds(suggestion.suggestedFinalDuration);

  return (
    <div className="mapping-suggestion-card" data-conflict={suggestion.conflictsWithWorkMap ? "true" : undefined}>
      <div className="mapping-suggestion-card__header">
        <div>
          <p className="mapping-suggestion-card__scene">
            {sceneName}
            {placeholderName ? ` — ${placeholderName}` : ""}
          </p>
          <span className={`status-badge status-badge--${SOURCE_TONE[suggestion.source]}`}>
            {suggestion.source === "DETERMINISTIC" ? t.mappingAssistant.sourceDeterministic : t.mappingAssistant.sourceAi}
          </span>
          <span className={`status-badge status-badge--${SCENE_EVIDENCE_TONE[sceneEvidenceStatus]}`}>
            {t.mappingAssistant.sceneEvidenceLabel}: {t.mappingAssistant.sceneEvidenceStatus[sceneEvidenceStatus]}
          </span>
        </div>
        <span className="mapping-suggestion-card__confidence">{t.mappingAssistant.confidenceLabel(Math.round(suggestion.confidence * 100))}</span>
      </div>

      {suggestion.unresolvedReason ? (
        <p className="mapping-suggestion-card__unresolved">{suggestion.unresolvedReason}</p>
      ) : (
        <dl className="mapping-suggestion-card__facts">
          {suggestedAssetLabel ? (
            <div>
              <dt>{t.mappingAssistant.suggestedAssetLabel}</dt>
              <dd>{suggestedAssetLabel}</dd>
            </div>
          ) : null}
          {suggestion.suggestedText ? (
            <div>
              <dt>{t.mappingAssistant.suggestedTextLabel}</dt>
              <dd>{suggestion.suggestedText}</dd>
            </div>
          ) : null}
          {timestamp ? (
            <div>
              <dt>{t.mappingAssistant.suggestedTimestampLabel}</dt>
              <dd>{timestamp}</dd>
            </div>
          ) : null}
          {duration ? (
            <div>
              <dt>{t.mappingAssistant.suggestedDurationLabel}</dt>
              <dd>{duration}</dd>
            </div>
          ) : null}
        </dl>
      )}

      {suggestion.conflictsWithWorkMap ? <p className="mapping-suggestion-card__conflict">{t.mappingAssistant.workMapConflict}</p> : null}

      {suggestion.reasoning ? <p className="mapping-suggestion-card__reasoning">{suggestion.reasoning}</p> : null}

      <ul className="mapping-suggestion-card__evidence">
        {suggestion.evidenceRefs.map((ref, index) => (
          <li key={index}>
            <span className={`status-badge status-badge--${EVIDENCE_TONE[ref.kind]}`}>{t.mappingAssistant.evidenceKind[ref.kind]}</span>
            {ref.summary}
          </li>
        ))}
      </ul>

      <div className="mapping-suggestion-card__actions">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onReject}>
          {t.mappingAssistant.rejectAction}
        </Button>
        <Button size="sm" variant="primary" disabled={busy} onClick={onAccept}>
          {t.mappingAssistant.acceptAction}
        </Button>
      </div>
    </div>
  );
}
