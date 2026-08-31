"use client";

import { useState, type ReactElement } from "react";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { useWorkspaceMode } from "./WorkspaceModeProvider";
import { SceneTable } from "./SceneTable";
import { SceneEditDrawer } from "./SceneEditDrawer";
import { MappingAssistantPanel } from "./MappingAssistantPanel";
import { SimpleScenesView } from "./SimpleScenesView";
import { ErrorState } from "./ErrorState";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { EmptyState } from "./EmptyState";
import { useLocale } from "./LocaleProvider";
import { computeFinalOrderSwap } from "../lib/scene-reorder";

export function ProjectScenesTab(): ReactElement {
  const { t } = useLocale();
  const { mode } = useWorkspaceMode();
  const { plan, applyEdit, isStale, createPlan } = useProjectWorkspaceContext();
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);
  const [createPlanError, setCreatePlanError] = useState<string | null>(null);

  // Every hook above runs unconditionally on every render (rules of
  // hooks) - only the RETURNED JSX branches on mode, right after.
  if (mode === "simple") {
    return <SimpleScenesView />;
  }

  async function handleCreatePlan(): Promise<void> {
    if (isCreatingPlan) {
      return;
    }
    setIsCreatingPlan(true);
    setCreatePlanError(null);
    const result = await createPlan();
    setIsCreatingPlan(false);
    if (!result.ok) {
      setCreatePlanError(result.message ?? null);
    }
    // On success, `plan` (from context) becomes non-null on the next
    // render, and this component renders the normal Scene Mapping UI
    // below - no reload, no separate "refresh" step needed.
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
              onClick={() => void handleCreatePlan()}
            >
              {isCreatingPlan
                ? t.projectWorkspace.creatingPlan
                : t.projectWorkspace.createPlanAction}
            </Button>
          }
        />
        {createPlanError ? (
          <ErrorState
            title={t.projectWorkspace.createPlanFailedTitle}
            description={createPlanError}
          />
        ) : null}
      </Card>
    );
  }

  async function handleToggleUse(scenePlanId: string, use: boolean): Promise<void> {
    setIsMutating(true);
    setMutationError(null);
    const result = await applyEdit([
      { type: use ? "INCLUDE_SCENE" : "EXCLUDE_SCENE", scenePlanId }
    ]);
    if (!result.ok) {
      setMutationError(result.message ?? null);
    }
    setIsMutating(false);
  }

  async function handleMove(scenePlanId: string, direction: "up" | "down"): Promise<void> {
    if (!plan) {
      return;
    }
    const reorderable = plan.plan.scenePlans.map((scene) => ({
      scenePlanId: scene.id,
      sourcePosition: scene.sourcePosition,
      finalOrder: scene.finalOrder,
      use: scene.use
    }));
    const swap = computeFinalOrderSwap(reorderable, scenePlanId, direction);
    if (!swap) {
      return;
    }
    setIsMutating(true);
    setMutationError(null);
    const result = await applyEdit(
      swap.map((assignment) => ({ type: "SET_FINAL_ORDER", ...assignment }))
    );
    if (!result.ok) {
      setMutationError(result.message ?? null);
    }
    setIsMutating(false);
  }

  return (
    <>
      {isStale ? (
        <ErrorState
          title={t.projectWorkspace.staleRevisionTitle}
          description={t.projectWorkspace.staleRevisionDescription}
        />
      ) : null}
      {mutationError ? (
        <ErrorState title={t.projectWorkspace.saveFailedTitle} description={mutationError} />
      ) : null}
      <MappingAssistantPanel />
      <Card>
        <SceneTable
          rows={plan.sceneTable}
          disabled={isMutating || isStale}
          onToggleUse={(scenePlanId, use) => void handleToggleUse(scenePlanId, use)}
          onMove={(scenePlanId, direction) => void handleMove(scenePlanId, direction)}
          onEditScene={setEditingSceneId}
        />
      </Card>
      <SceneEditDrawer scenePlanId={editingSceneId} onClose={() => setEditingSceneId(null)} />
    </>
  );
}
