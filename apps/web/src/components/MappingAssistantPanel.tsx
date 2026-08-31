"use client";

import { useState, type ReactElement } from "react";
import type { EvidenceRef, MappingSuggestion, SceneEvidenceStatus, SuggestionSource } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { useMappingSuggestions } from "../lib/use-mapping-suggestions";
import { useProjectAssets } from "../lib/use-project-assets";
import { dispatchJob } from "../lib/projects-api-client";
import { findDispatchableWorker } from "../lib/find-dispatchable-worker";
import { isSafeToBulkAccept } from "../lib/safe-bulk-accept";
import { Card, CardHeader } from "./ui/Card";
import { Button } from "./ui/Button";
import { ClaudeActionButton } from "./ui/ClaudeActionButton";
import { Dialog } from "./ui/Dialog";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { Skeleton } from "./ui/Skeleton";
import { HelpTooltip } from "./ui/HelpTooltip";
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

/**
 * Video-planning UX simplification, 2026-08-31: matches the SAME 0.5
 * threshold generate-mapping-suggestions.ts already enforces server-side
 * (a proposal under 0.5 confidence naming concrete content is downgraded
 * to a plain "needs review" placeholder before it is ever persisted - see
 * that file's own doc comment) - "needsReview" here is never reachable
 * for a genuinely low-confidence *content* suggestion, only shown for a
 * real suggestion whose own confidence is still below the threshold for
 * some other reason (e.g. a deterministic non-match). "high"/"medium" are
 * plain-language labels only - the exact percentage remains available
 * under "Why this suggestion?" for anyone who wants it.
 */
type ConfidenceLevel = "high" | "medium" | "needsReview";
const CONFIDENCE_TONE: Record<ConfidenceLevel, Tone> = { high: "positive", medium: "info", needsReview: "neutral" };

function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.5) return "medium";
  return "needsReview";
}

export function MappingAssistantPanel(): ReactElement | null {
  const { t } = useLocale();
  const { project, plan, refetch } = useProjectWorkspaceContext();
  const { suggestions, aiAvailable, sceneEvidenceAvailability, isLoading, isGenerating, error, generate, accept, reject, acceptBatch } =
    useMappingSuggestions(project?.project.projectId ?? "");
  const { assets } = useProjectAssets(project?.project.projectId ?? "");
  const { data: dashboardStatus } = useDashboardStatusContext();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null);
  const [improvingSceneId, setImprovingSceneId] = useState<string | null>(null);
  const [improveMessage, setImproveMessage] = useState<{ sceneId: string; text: string; isError: boolean } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirmIds, setBulkConfirmIds] = useState<string[] | null>(null);
  const [isBulkAccepting, setIsBulkAccepting] = useState(false);

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

  /**
   * "Improve AI accuracy" (offline-safe-control-plane phase, section 2/3) -
   * dispatches the real INSPECT_SCENE_EVIDENCE operation via the SAME safe,
   * server-resolved path EXECUTE_FRAME/RENDER already use (see
   * resolve-inspect-scene-evidence-dispatch.ts): the browser sends only
   * `scenePlanId`, never a raw sourceProjectPath or layer indices. This is
   * read-only (see CLAUDE.md/scene-evidence.ts) - it never saves the .aep,
   * modifies layers, or touches mapping/execution-plan approval. Existing
   * suggestions are never auto-regenerated here; the user must still click
   * "Generate Suggestions" explicitly once evidence is ready.
   */
  async function handleImproveAccuracy(scenePlanId: string): Promise<void> {
    setImprovingSceneId(scenePlanId);
    setImproveMessage(null);
    const worker = findDispatchableWorker(dashboardStatus?.workers ?? null, "INSPECT_SCENE_EVIDENCE");
    if (!worker) {
      setImprovingSceneId(null);
      setImproveMessage({ sceneId: scenePlanId, text: t.mappingAssistant.editingComputerOffline, isError: true });
      return;
    }
    const result = await dispatchJob({ operation: "INSPECT_SCENE_EVIDENCE", workerId: worker.workerId, projectId: project!.project.projectId, scenePlanId });
    setImprovingSceneId(null);
    if (!result.ok) {
      setImproveMessage({ sceneId: scenePlanId, text: result.message, isError: true });
      return;
    }
    setImproveMessage({ sceneId: scenePlanId, text: t.mappingAssistant.improveAccuracyQueued, isError: false });
  }

  function toggleSelected(suggestionId: string): void {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(suggestionId)) {
        next.delete(suggestionId);
      } else {
        next.add(suggestionId);
      }
      return next;
    });
  }

  /**
   * Client-handoff phase, section I, point 6: "Bulk acceptance must
   * require explicit user confirmation." This only ever OPENS the
   * confirmation dialog (see handleConfirmBulkAccept below for the real
   * accept call) - clicking "Accept All Safe Suggestions"/"Accept All in
   * This Scene" stages the selection and shows exactly what is about to
   * be accepted, it never accepts anything by itself.
   */
  function openBulkConfirm(ids: string[]): void {
    setSelectedIds(new Set(ids));
    setBulkConfirmIds(ids);
  }

  async function handleConfirmBulkAccept(): Promise<void> {
    if (!bulkConfirmIds || bulkConfirmIds.length === 0) {
      return;
    }
    setIsBulkAccepting(true);
    setActionError(null);
    const result = await acceptBatch(bulkConfirmIds, plan!.plan.revision);
    setIsBulkAccepting(false);
    setBulkConfirmIds(null);
    if (!result.ok) {
      setActionError(result.message ?? null);
      return;
    }
    setSelectedIds(new Set());
    await refetch();
  }

  const pending = (suggestions ?? []).filter((s) => s.status === "PENDING");
  const reviewed = (suggestions ?? []).filter((s) => s.status !== "PENDING");
  const safeSuggestions = pending.filter(isSafeToBulkAccept);
  const safeIds = new Set(safeSuggestions.map((s) => s.id));
  const needsReviewCount = pending.length - safeSuggestions.length;
  const selectedSafeCount = [...selectedIds].filter((id) => safeIds.has(id)).length;
  const bulkConfirmScenes = bulkConfirmIds
    ? [...new Set(bulkConfirmIds.map((id) => sceneById.get(pending.find((s) => s.id === id)?.scenePlanId ?? "")?.compositionName).filter((name): name is string => Boolean(name)))]
    : [];

  // Groups by scene in the plan's own real order - never invents an
  // ordering. A suggestion whose scene can't be resolved (should not
  // happen for a real persisted suggestion, but never assumed) falls into
  // one final "Ungrouped" bucket rather than being silently dropped.
  const scenePlanOrder = plan.plan.scenePlans.map((scene) => scene.id);
  const suggestionsByScene = new Map<string, MappingSuggestion[]>();
  for (const suggestion of pending) {
    const key = sceneById.has(suggestion.scenePlanId) ? suggestion.scenePlanId : "__ungrouped__";
    const bucket = suggestionsByScene.get(key) ?? [];
    bucket.push(suggestion);
    suggestionsByScene.set(key, bucket);
  }
  const orderedSceneIds = [...scenePlanOrder.filter((id) => suggestionsByScene.has(id)), ...(suggestionsByScene.has("__ungrouped__") ? ["__ungrouped__"] : [])];

  return (
    <Card>
      <CardHeader
        title={t.mappingAssistant.title}
        action={
          <div className="mapping-assistant__header-actions">
            <span className={`status-badge status-badge--${aiAvailable ? "positive" : "neutral"}`}>
              {aiAvailable ? t.mappingAssistant.aiAvailable : t.mappingAssistant.aiUnavailable}
            </span>
            {aiAvailable ? (
              // A real Anthropic call genuinely happens for this dispatch
              // only when aiAvailable is true (generate-mapping-suggestions.ts
              // always runs deterministic matching regardless - AI is
              // additive, never required) - Claude branding follows that
              // real fact, never shown when this click is deterministic-only.
              <ClaudeActionButton
                size="sm"
                label={t.mappingAssistant.generateAction}
                busyLabel={t.mappingAssistant.generating}
                busy={isGenerating}
                onClick={() => void handleGenerate()}
              />
            ) : (
              <Button size="sm" variant="primary" disabled={isGenerating} onClick={() => void handleGenerate()}>
                {isGenerating ? t.mappingAssistant.generating : t.mappingAssistant.generateAction}
              </Button>
            )}
          </div>
        }
      />
      <p>{t.mappingAssistant.description}</p>
      {!isLoading && !aiAvailable ? <p className="field__hint">{t.mappingAssistant.connectProviderHint}</p> : null}

      {error ? <ErrorState title={t.projectWorkspace.loadErrorTitle} description={error} /> : null}
      {actionError ? <ErrorState title={t.projectWorkspace.saveFailedTitle} description={actionError} /> : null}

      {isLoading ? (
        <Skeleton height="1.5rem" />
      ) : pending.length === 0 ? (
        <EmptyState title={t.mappingAssistant.emptyTitle} description={t.mappingAssistant.emptyDescription} />
      ) : null}

      {!isLoading && pending.length > 0 ? (
        <div className="mapping-bulk-toolbar">
          <div className="mapping-bulk-toolbar__counts">
            <span>
              {t.mappingAssistant.bulk.safeCount(safeSuggestions.length)}
              <HelpTooltip text={t.helpTooltips.safeSuggestions} />
            </span>
            {needsReviewCount > 0 ? (
              <span className="field__hint">
                {t.mappingAssistant.bulk.needsReviewCount(needsReviewCount)}
                <HelpTooltip text={t.helpTooltips.needsReview} />
              </span>
            ) : null}
            {selectedSafeCount > 0 ? <span className="field__hint">{t.mappingAssistant.bulk.selectedCount(selectedSafeCount)}</span> : null}
          </div>
          <div className="mapping-bulk-toolbar__actions">
            {selectedSafeCount > 0 ? (
              <Button size="sm" variant="secondary" onClick={() => openBulkConfirm([...selectedIds].filter((id) => safeIds.has(id)))}>
                {t.mappingAssistant.bulk.acceptSelectedAction(selectedSafeCount)}
              </Button>
            ) : null}
            <Button size="sm" variant="primary" disabled={safeSuggestions.length === 0} onClick={() => openBulkConfirm(safeSuggestions.map((s) => s.id))}>
              {t.mappingAssistant.bulk.acceptAllSafeAction}
            </Button>
          </div>
        </div>
      ) : null}

      {!isLoading && pending.length > 0 ? (
        <div className="mapping-suggestion-scene-groups">
          {orderedSceneIds.map((sceneId) => {
            const scene = sceneId === "__ungrouped__" ? null : sceneById.get(sceneId);
            const sceneName = scene?.compositionName ?? t.mappingAssistant.sceneGroupFallback;
            const sceneEvidenceStatus: SceneEvidenceStatus = (scene && sceneEvidenceAvailability[scene.manifestCompositionId]) ?? "NOT_INSPECTED";
            const groupSuggestions = suggestionsByScene.get(sceneId) ?? [];
            const sceneSafeIds = groupSuggestions.filter(isSafeToBulkAccept).map((s) => s.id);
            return (
              <section key={sceneId} className="mapping-suggestion-scene-group">
                <div className="mapping-suggestion-scene-group__header">
                  <h3>{sceneName}</h3>
                  <span className={`status-badge status-badge--${SCENE_EVIDENCE_TONE[sceneEvidenceStatus]}`}>
                    {t.mappingAssistant.sceneEvidenceLabel}: {t.mappingAssistant.sceneEvidenceStatus[sceneEvidenceStatus]}
                  </span>
                  {scene && sceneEvidenceStatus !== "AVAILABLE" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={improvingSceneId === scene.id}
                      onClick={() => void handleImproveAccuracy(scene.id)}
                    >
                      {improvingSceneId === scene.id ? t.mappingAssistant.improvingAccuracy : t.mappingAssistant.improveAccuracyAction}
                    </Button>
                  ) : null}
                  {sceneSafeIds.length > 0 ? (
                    <Button size="sm" variant="secondary" onClick={() => openBulkConfirm(sceneSafeIds)}>
                      {t.mappingAssistant.bulk.acceptAllInSceneAction}
                    </Button>
                  ) : null}
                </div>
                {improveMessage && scene && improveMessage.sceneId === scene.id ? (
                  <p className={improveMessage.isError ? "mapping-suggestion-scene-group__improve-error" : "field__hint"}>{improveMessage.text}</p>
                ) : null}
                <div className="mapping-suggestion-list">
                  {groupSuggestions.map((suggestion) => {
                    const mapping = scene?.mappings.find((m) => m.id === suggestion.mappingId) ?? null;
                    const suggestedAsset = suggestion.suggestedAssetId ? assetById.get(suggestion.suggestedAssetId) : null;
                    return (
                      <MappingSuggestionCard
                        key={suggestion.id}
                        suggestion={suggestion}
                        placeholderName={mapping?.placeholderName ?? null}
                        suggestedAssetLabel={suggestedAsset ? (suggestedAsset.label ?? suggestedAsset.originalFilename) : null}
                        busy={busySuggestionId === suggestion.id}
                        safe={safeIds.has(suggestion.id)}
                        selected={selectedIds.has(suggestion.id)}
                        onToggleSelect={() => toggleSelected(suggestion.id)}
                        onAccept={() => void handleAccept(suggestion)}
                        onReject={() => void handleReject(suggestion)}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      <Dialog open={bulkConfirmIds !== null} onClose={() => setBulkConfirmIds(null)} title={t.mappingAssistant.bulk.confirmTitle} variant="modal">
        <p>{t.mappingAssistant.bulk.confirmDescription(bulkConfirmIds?.length ?? 0)}</p>
        {bulkConfirmScenes.length > 0 ? (
          <ul className="mapping-bulk-confirm__scenes">
            {bulkConfirmScenes.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        ) : null}
        <div className="edit-drawer-actions">
          <Button variant="ghost" disabled={isBulkAccepting} onClick={() => setBulkConfirmIds(null)}>
            {t.mappingAssistant.bulk.cancelAction}
          </Button>
          <Button variant="primary" disabled={isBulkAccepting} onClick={() => void handleConfirmBulkAccept()}>
            {isBulkAccepting ? t.mappingAssistant.bulk.accepting : t.mappingAssistant.bulk.confirmAction}
          </Button>
        </div>
      </Dialog>

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
  placeholderName,
  suggestedAssetLabel,
  busy,
  safe,
  selected,
  onToggleSelect,
  onAccept,
  onReject
}: {
  suggestion: MappingSuggestion;
  placeholderName: string | null;
  suggestedAssetLabel: string | null;
  busy: boolean;
  safe: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onAccept: () => void;
  onReject: () => void;
}): ReactElement {
  const { t } = useLocale();
  const timestamp = formatSeconds(suggestion.suggestedAssetTimestamp);
  const duration = formatSeconds(suggestion.suggestedFinalDuration);
  const level = confidenceLevel(suggestion.confidence);

  return (
    <div className="mapping-suggestion-card" data-conflict={suggestion.conflictsWithWorkMap ? "true" : undefined}>
      <div className="mapping-suggestion-card__header">
        <div className="mapping-suggestion-card__title">
          {safe ? (
            <input
              type="checkbox"
              aria-label={t.mappingAssistant.bulk.selectSuggestionLabel}
              checked={selected}
              disabled={busy}
              onChange={onToggleSelect}
            />
          ) : null}
          <div>
            <p className="mapping-suggestion-card__scene">{placeholderName ?? ""}</p>
            <span className={`status-badge status-badge--${SOURCE_TONE[suggestion.source]}`}>
              {suggestion.source === "DETERMINISTIC" ? t.mappingAssistant.sourceDeterministic : t.mappingAssistant.sourceAi}
            </span>
          </div>
        </div>
        <span className={`status-badge status-badge--${CONFIDENCE_TONE[level]}`}>{t.mappingAssistant.confidenceLevel[level]}</span>
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

      <details className="advanced-details">
        <summary>{t.mappingAssistant.whyThisSuggestion}</summary>
        <p className="mapping-suggestion-card__confidence">{t.mappingAssistant.confidenceLabel(Math.round(suggestion.confidence * 100))}</p>
        {suggestion.reasoning ? <p className="mapping-suggestion-card__reasoning">{suggestion.reasoning}</p> : null}
        <ul className="mapping-suggestion-card__evidence">
          {suggestion.evidenceRefs.map((ref, index) => (
            <li key={index}>
              <span className={`status-badge status-badge--${EVIDENCE_TONE[ref.kind]}`}>{t.mappingAssistant.evidenceKind[ref.kind]}</span>
              {ref.summary}
            </li>
          ))}
        </ul>
      </details>

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
