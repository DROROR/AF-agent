"use client";

import Link from "next/link";
import { useState, type ReactElement } from "react";
import type { MappingSuggestion } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { useMappingSuggestions } from "../lib/use-mapping-suggestions";
import { resolveSceneMappingHomes } from "../lib/scene-mapping-homes";
import { useProjectAssets } from "../lib/use-project-assets";
import { groupIntoRealScenes, type RealScene } from "../lib/real-scene-grouping";
import { isScenePreviewSettled, useScenePreviewQueue, type UseScenePreviewQueueResult } from "../lib/use-scene-preview-queue";
import { sceneEvidencePreviewFileUrl } from "../lib/projects-api-client";
import { SceneCard } from "./SceneCard";
import { SceneEditDrawer } from "./SceneEditDrawer";
import { SlotBulkReview } from "./SlotBulkReview";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { ClaudeActionButton } from "./ui/ClaudeActionButton";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { Skeleton } from "./ui/Skeleton";
import { useLocale } from "./LocaleProvider";

/**
 * A compact visual storyboard (client-facing UX redesign, "M. VISUAL
 * PREVIEWS ARE MANDATORY", point 10) - one small thumbnail per real
 * scene, so a client can see the whole video's shape before diving into
 * individual cards. Reads the SAME shared preview queue state the scene
 * cards below use (never a separate fetch) - the storyboard and the
 * scene cards always agree on which scenes are real and what each one's
 * current preview is. "Play Full Preview" links to the Overview tab,
 * where the real AE-sourced complete-preview player and its own approval
 * gate already live (ProjectOverviewTab) - never duplicated here.
 */
function Storyboard({
  projectId,
  realScenes,
  previewQueue
}: {
  projectId: string;
  realScenes: RealScene[];
  previewQueue: UseScenePreviewQueueResult;
}): ReactElement | null {
  const { t } = useLocale();
  if (realScenes.length === 0) {
    return null;
  }
  return (
    <Card className="storyboard">
      <div className="storyboard__header">
        <h3>{t.simpleScenes.storyboardTitle}</h3>
        <Link href={`/projects/${projectId}`} className="btn btn--secondary btn--sm">
          {t.simpleScenes.playFullPreviewAction}
        </Link>
      </div>
      <div className="storyboard__strip">
        {realScenes.map((realScene) => (
          <StoryboardThumb key={realScene.manifestCompositionId} projectId={projectId} realScene={realScene} preview={previewQueue.getEntry(realScene.scenePlan.id).preview} />
        ))}
      </div>
    </Card>
  );
}

function StoryboardThumb({
  projectId,
  realScene,
  preview
}: {
  projectId: string;
  realScene: RealScene;
  preview: ReturnType<UseScenePreviewQueueResult["getEntry"]>["preview"];
}): ReactElement {
  return (
    <div className="storyboard__thumb">
      {preview ? (
        <img src={sceneEvidencePreviewFileUrl(projectId, realScene.scenePlan.id)} alt={realScene.sceneName} />
      ) : (
        <div className="storyboard__thumb-placeholder" aria-hidden="true" />
      )}
      <span>{realScene.sceneName}</span>
    </div>
  );
}

/**
 * "Review Scenes" (client-facing UX redesign, sections B-G + "M. VISUAL
 * PREVIEWS ARE MANDATORY" + the "LIVE UX ACCEPTANCE FAILED" section 6
 * follow-up) - one visual card per REAL user-facing scene (never one row
 * per raw AE composition/placeholder), each with a real visual preview
 * generated AUTOMATICALLY (see use-scene-preview-queue.ts) and only
 * genuine content decisions surfaced for review. Structural/no-op
 * suggestions never reach here - useMappingSuggestions only ever returns
 * PENDING items, and RESOLVED (structural keep-original) suggestions are
 * a separate bucket this view never renders (see MappingAssistantPanel's
 * own `resolved` split for the Advanced-mode equivalent).
 */
export function SimpleScenesView(): ReactElement {
  const { t } = useLocale();
  const { project, plan, approveScenes, isStale, createPlan, refetch } = useProjectWorkspaceContext();
  // 2026-09-28: Simple mode consumed suggestions but could never ASK for
  // them - `generate` lived only in MappingAssistantPanel, which Advanced
  // mode renders and Simple mode does not. So the view that exists to be the
  // easy path showed "Needs your choice" on every scene with nothing
  // suggested, and the one feature that would have answered it was reachable
  // only by switching to Advanced. Reported by a real operator mid-session.
  const { suggestions, aiAvailable, isGenerating, error: suggestionsError, generate, accept, reject, acceptBatch } = useMappingSuggestions(
    project?.project.projectId ?? ""
  );
  const { assets } = useProjectAssets(project?.project.projectId ?? "");
  const { data: dashboardStatus } = useDashboardStatusContext();
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  // Set when Edit is pressed on a card that SHOWS layers another scene
  // owns: the drawer then opens the owner, narrowed to that card's layers.
  const [editingMappingIds, setEditingMappingIds] = useState<string[] | null>(null);
  const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);

  const projectId = project?.project.projectId ?? "";
  const realScenes = project && plan ? groupIntoRealScenes(project.manifest, plan.plan.scenePlans) : [];
  const previewQueue = useScenePreviewQueue(projectId, realScenes, dashboardStatus?.workers ?? null, project?.project.sourceWorkerId ?? null);

  if (!project) {
    return <Skeleton height="1.5rem" />;
  }

  if (!plan) {
    return (
      <Card>
        <EmptyState
          title={t.projectWorkspace.noPlanTitle}
          description={t.projectWorkspace.noPlanDescription}
          action={
            <Button
              variant="primary"
              disabled={isCreatingPlan}
              onClick={() => {
                setIsCreatingPlan(true);
                void createPlan().finally(() => setIsCreatingPlan(false));
              }}
            >
              {isCreatingPlan ? t.projectWorkspace.creatingPlan : t.projectWorkspace.createPlanAction}
            </Button>
          }
        />
      </Card>
    );
  }

  const pending = (suggestions ?? []).filter((s) => s.status === "PENDING");
  const allProposals = (suggestions ?? []).filter(
    (s) => s.status === "PENDING" && (s.suggestedText !== null || s.suggestedAssetId !== null || s.suggestedClassification !== null)
  );
  const pendingByScene = new Map<string, MappingSuggestion[]>();
  // Which card each layer is shown on - see resolveSceneMappingHomes.
  const homes = resolveSceneMappingHomes(project.manifest, realScenes);
  for (const suggestion of pending) {
    // Was bucketed by suggestion.scenePlanId alone, which put every
    // suggestion of a single-master template on the master's one card.
    // const bucket = pendingByScene.get(suggestion.scenePlanId) ?? [];
    const cardId = (suggestion.mappingId !== null ? homes.cardIdByMappingId.get(suggestion.mappingId) : undefined) ?? suggestion.scenePlanId;
    const bucket = pendingByScene.get(cardId) ?? [];
    bucket.push(suggestion);
    pendingByScene.set(cardId, bucket);
  }

  const reviewsReady = realScenes.every(
    (scene) =>
      (pendingByScene.get(scene.scenePlan.id)?.length ?? 0) === 0 &&
      (scene.scenePlan.approvalState === "READY_FOR_APPROVAL" || scene.scenePlan.approvalState === "APPROVED")
  );
  // Preview freshness (final MVP polish item 2): a stale scene preview -
  // captured before the mapped asset/text/timestamp/duration change that
  // is now current, per useScenePreviewQueue's own isStale check - can
  // never be treated as the current, approved-against evidence. This
  // never requires a manual refresh: the same queue that computed
  // isStale already auto-queued a fresh capture for it (see
  // use-scene-preview-queue.ts's own needsPreview logic), so this
  // condition self-resolves as soon as that regeneration completes -
  // approval is simply held until the client is genuinely looking at the
  // real, current result, not a guess about whether it still matches.
  // A preview whose generation definitively failed is settled too - see
  // isScenePreviewSettled for the real lock this prevents.
  const previewsReady = realScenes.every((scene) => isScenePreviewSettled(previewQueue.getEntry(scene.scenePlan.id)));
  const allReady = reviewsReady && previewsReady;
  // Approved means executable: the plan AND every included scene - exactly
  // what the Preview tab needs (see useProjectWorkspace's approveScenes).
  const usedScenes = plan.plan.scenePlans.filter((scene) => scene.use);
  const scenesApproved = plan.plan.status === "APPROVED" && usedScenes.length > 0 && usedScenes.every((scene) => scene.approvalState === "APPROVED");

  // REAL 2026-09-25 INCIDENT: "Approve Scenes" is disabled for FIVE
  // genuinely different reasons and looked identical in all of them. Three
  // of those five were already explained by the status line rendered
  // directly above the button (approved / not reviewed / previews
  // updating) - those keep that existing wording, which real regression
  // tests pin to specific incidents. The two that were NEVER explained
  // anywhere - a revision saved elsewhere, and an approval already in
  // flight - now state themselves on the control itself. Evaluated in the
  // same order as the `disabled` expression below, so the stated reason is
  // always the one really holding the button.
  const approveDisabledReason = scenesApproved || !allReady ? undefined : isStale ? t.projectWorkspace.disabledReason.staleRevision : isApproving ? t.projectWorkspace.disabledReason.working : undefined;

  async function handleAccept(suggestion: MappingSuggestion): Promise<void> {
    setBusySuggestionId(suggestion.id);
    setActionError(null);
    const result = await accept(suggestion.id, plan!.plan.revision);
    setBusySuggestionId(null);
    if (!result.ok) {
      setActionError(result.message ?? null);
      return;
    }
    // Accepting writes to the plan and moves its revision on. REAL 2026-10-02
    // DEFECT: this screen kept the old one, so the very next edit was refused
    // with "Expected revision 3, but the current revision is 4", and the card
    // went on showing "No text set" for a text that had just been accepted.
    await refetch();
  }

  /** Several suggestions in one request - one plan revision, one result. */
  async function handleAcceptMany(many: MappingSuggestion[]): Promise<void> {
    if (many.length === 0) {
      return;
    }
    setBusySuggestionId(many[0]!.id);
    setActionError(null);
    const result = await acceptBatch(
      many.map((suggestion) => suggestion.id),
      plan!.plan.revision
    );
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

  async function handleApprove(): Promise<void> {
    if (isApproving) {
      return;
    }
    setIsApproving(true);
    setActionError(null);
    const result = await approveScenes();
    setIsApproving(false);
    if (!result.ok) {
      setActionError(result.message ?? null);
    }
  }

  return (
    <>
      {isStale ? <ErrorState title={t.projectWorkspace.staleRevisionTitle} description={t.projectWorkspace.staleRevisionDescription} /> : null}
      {actionError ? <ErrorState title={t.projectWorkspace.saveFailedTitle} description={actionError} /> : null}

      <Storyboard projectId={projectId} realScenes={realScenes} previewQueue={previewQueue} />

      {suggestionsError ? (
        <ErrorState title={t.mappingAssistant.title} description={suggestionsError} />
      ) : null}

      <Card className="simple-scenes__approve-bar">
        <p>
          {scenesApproved
            ? t.simpleScenes.scenesApprovedHint
            : allProposals.length > 0
              ? t.simpleScenes.usePlanFirstHint
              : allReady
              ? t.simpleScenes.allScenesReadyHint
              : !reviewsReady
                ? t.simpleScenes.scenesNotReadyHint
                : t.simpleScenes.previewsUpdatingHint}
        </p>
        {/*
          The ASK half of the Mapping Assistant, in the view that exists to be
          the easy path. Simple mode already accepted and rejected suggestions
          per scene; it simply had no way to request any, so every scene read
          "Needs your choice" with nothing proposed. It sits in this existing
          bar rather than a row of its own, beside the action it feeds, and
          carries the same Claude affordance Advanced uses - because the same
          real Anthropic call is what happens on the click. The full panel,
          with its evidence and review history, stays in Advanced.
        */}
        {aiAvailable ? null : (
          // Never a dead button: with no provider connected, say what would
          // connect one instead of offering an action that cannot happen.
          <p className="simple-scenes__ai-hint">{t.mappingAssistant.connectProviderHint}</p>
        )}
        {aiAvailable ? (
          <ClaudeActionButton
            label={t.mappingAssistant.generateAction}
            busyLabel={t.mappingAssistant.generating}
            busy={isGenerating}
            disabled={isStale}
            onClick={() => void generate()}
          />
        ) : null}
        {/*
          REAL 2026-10-04: a plan the client had already read and continued
          from on the AI Plan tab had to be taken again here card by card -
          eight presses for eight scenes. One press takes every line that
          proposes something; each stays changeable on its card afterwards,
          and nothing is approved by it - Approve Scenes is still its own step.
        */}
        {allProposals.length > 0 ? (
          <Button variant="secondary" disabled={busySuggestionId !== null || isStale} onClick={() => void handleAcceptMany(allProposals)}>
            {t.simpleScenes.useWholePlanAction(allProposals.length)}
          </Button>
        ) : null}
        <Button
          variant="primary"
          disabled={scenesApproved || !allReady || isApproving || isStale}
          disabledReason={approveDisabledReason}
          onClick={() => void handleApprove()}
        >
          {isApproving ? t.simpleScenes.approvingScenes : t.simpleScenes.approveScenesAction}
        </Button>
      </Card>

      <SlotBulkReview />

      {realScenes.length === 0 ? (
        <Card>
          <EmptyState title={t.simpleScenes.emptyTitle} description={t.simpleScenes.emptyDescription} />
        </Card>
      ) : (
        <div className="simple-scenes__grid">
          {realScenes.map((realScene) => (
            <SceneCard
              key={realScene.manifestCompositionId}
              projectId={projectId}
              realScene={realScene}
              assets={assets}
              previewEntry={previewQueue.getEntry(realScene.scenePlan.id)}
              pendingSuggestions={pendingByScene.get(realScene.scenePlan.id) ?? []}
              suggestionsBusy={busySuggestionId !== null}
              cardMappings={(homes.mappingsByCardId.get(realScene.scenePlan.id) ?? []).map((hosted) => hosted.mapping)}
              // onEdit={() => setEditingSceneId(realScene.scenePlan.id)}
              onEdit={() => {
                const hosted = homes.mappingsByCardId.get(realScene.scenePlan.id) ?? [];
                const owner = hosted.find((entry) => entry.ownerScenePlanId !== realScene.scenePlan.id);
                if (owner) {
                  // This card shows layers another scene owns: open the
                  // owner, narrowed to just the layers shown here.
                  setEditingMappingIds(hosted.filter((entry) => entry.ownerScenePlanId === owner.ownerScenePlanId).map((entry) => entry.mapping.id));
                  setEditingSceneId(owner.ownerScenePlanId);
                } else {
                  const shownIds = hosted.map((entry) => entry.mapping.id);
                  setEditingMappingIds(shownIds.length === realScene.scenePlan.mappings.length ? null : shownIds);
                  setEditingSceneId(realScene.scenePlan.id);
                }
              }}
              onRegeneratePreview={() => previewQueue.regenerate(realScene.scenePlan.id)}
              onAcceptSuggestion={(suggestion) => void handleAccept(suggestion)}
              onRejectSuggestion={(suggestion) => void handleReject(suggestion)}
              onAcceptSuggestions={(many) => void handleAcceptMany(many)}
            />
          ))}
        </div>
      )}

      <SceneEditDrawer
        scenePlanId={editingSceneId}
        onlyMappingIds={editingMappingIds}
        onClose={() => {
          setEditingSceneId(null);
          setEditingMappingIds(null);
        }}
      />
    </>
  );
}
