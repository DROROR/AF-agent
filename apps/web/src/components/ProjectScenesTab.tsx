"use client";

import { useState, type ReactElement } from "react";
import { useProjectWorkspaceContext } from "./ProjectWorkspaceProvider";
import { SceneTable } from "./SceneTable";
import { SceneEditDrawer } from "./SceneEditDrawer";
import { ErrorState } from "./ErrorState";
import { Card } from "./ui/Card";
import { EmptyState } from "./EmptyState";
import { useLocale } from "./LocaleProvider";
import { computeFinalOrderSwap } from "../lib/scene-reorder";

export function ProjectScenesTab(): ReactElement {
  const { t } = useLocale();
  const { plan, applyEdit, isStale } = useProjectWorkspaceContext();
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  if (!plan) {
    return (
      <Card>
        <EmptyState title={t.projectWorkspace.noPlanTitle} description={t.projectWorkspace.noPlanDescription} />
      </Card>
    );
  }

  async function handleToggleUse(scenePlanId: string, use: boolean): Promise<void> {
    setIsMutating(true);
    setMutationError(null);
    const result = await applyEdit([{ type: use ? "INCLUDE_SCENE" : "EXCLUDE_SCENE", scenePlanId }]);
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
    const result = await applyEdit(swap.map((assignment) => ({ type: "SET_FINAL_ORDER", ...assignment })));
    if (!result.ok) {
      setMutationError(result.message ?? null);
    }
    setIsMutating(false);
  }

  return (
    <>
      {isStale ? <ErrorState title={t.projectWorkspace.staleRevisionTitle} description={t.projectWorkspace.staleRevisionDescription} /> : null}
      {mutationError ? <ErrorState title={t.projectWorkspace.saveFailedTitle} description={mutationError} /> : null}
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
