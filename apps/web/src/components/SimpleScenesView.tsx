"use client";

import Link from "next/link";
import { useState, type ReactElement } from "react";
import type { MappingSuggestion } from "@dyo/schemas";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useDashboardStatusContext } from "./DashboardStatusProvider";
import { useMappingSuggestions } from "../lib/use-mapping-suggestions";
import { useProjectAssets } from "../lib/use-project-assets";
import { groupIntoRealScenes, type RealScene } from "../lib/real-scene-grouping";
import { useScenePreviewQueue, type UseScenePreviewQueueResult } from "../lib/use-scene-preview-queue";
import { sceneEvidencePreviewFileUrl } from "../lib/projects-api-client";
import { SceneCard } from "./SceneCard";
import { SceneEditDrawer } from "./SceneEditDrawer";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
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
  const { project, plan, approve, isStale, createPlan } = useProjectWorkspaceContext();
  const { suggestions, accept, reject } = useMappingSuggestions(project?.project.projectId ?? "");
  const { assets } = useProjectAssets(project?.project.projectId ?? "");
  const { data: dashboardStatus } = useDashboardStatusContext();
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [busySuggestionId, setBusySuggestionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);

  const projectId = project?.project.projectId ?? "";
  const realScenes = project && plan ? groupIntoRealScenes(project.manifest, plan.plan.scenePlans) : [];
  const previewQueue = useScenePreviewQueue(projectId, realScenes, dashboardStatus?.workers ?? null);

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
  const pendingByScene = new Map<string, MappingSuggestion[]>();
  for (const suggestion of pending) {
    const bucket = pendingByScene.get(suggestion.scenePlanId) ?? [];
    bucket.push(suggestion);
    pendingByScene.set(suggestion.scenePlanId, bucket);
  }

  const allReady = realScenes.every(
    (scene) =>
      (pendingByScene.get(scene.scenePlan.id)?.length ?? 0) === 0 &&
      (scene.scenePlan.approvalState === "READY_FOR_APPROVAL" || scene.scenePlan.approvalState === "APPROVED")
  );

  async function handleAccept(suggestion: MappingSuggestion): Promise<void> {
    setBusySuggestionId(suggestion.id);
    setActionError(null);
    const result = await accept(suggestion.id, plan!.plan.revision);
    setBusySuggestionId(null);
    if (!result.ok) {
      setActionError(result.message ?? null);
    }
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
    setIsApproving(true);
    setActionError(null);
    const result = await approve();
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

      <Card className="simple-scenes__approve-bar">
        <p>{allReady ? t.simpleScenes.allScenesReadyHint : t.simpleScenes.scenesNotReadyHint}</p>
        <Button variant="primary" disabled={!allReady || isApproving || isStale} onClick={() => void handleApprove()}>
          {isApproving ? t.simpleScenes.approvingScenes : t.simpleScenes.approveScenesAction}
        </Button>
      </Card>

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
              onEdit={() => setEditingSceneId(realScene.scenePlan.id)}
              onRegeneratePreview={() => previewQueue.regenerate(realScene.scenePlan.id)}
              onAcceptSuggestion={(suggestion) => void handleAccept(suggestion)}
              onRejectSuggestion={(suggestion) => void handleReject(suggestion)}
            />
          ))}
        </div>
      )}

      <SceneEditDrawer scenePlanId={editingSceneId} onClose={() => setEditingSceneId(null)} />
    </>
  );
}
