"use client";

import { useCallback, useEffect, useState } from "react";
import type { ExecutionPlanResponse, MappingSuggestion, SceneEvidenceStatus } from "@dyo/schemas";
import {
  acceptMappingSuggestion,
  batchAcceptMappingSuggestions,
  fetchMappingSuggestions,
  generateMappingSuggestions,
  rejectMappingSuggestion
} from "./projects-api-client";

export interface MappingSuggestionMutationOutcome {
  ok: boolean;
  message?: string;
  /** Set only on a successful accept/batch-accept - the caller (ProjectWorkspaceProvider's plan state) must be refreshed with this, since the plan just changed outside its own applyEdit path. */
  executionPlan?: ExecutionPlanResponse;
}

export interface MappingSuggestionsState {
  suggestions: MappingSuggestion[] | null;
  aiAvailable: boolean;
  /** Keyed by manifestCompositionId - see mapping-suggestion.ts's own doc comment on why every scene gets an entry. */
  sceneEvidenceAvailability: Record<string, SceneEvidenceStatus>;
  isLoading: boolean;
  isGenerating: boolean;
  error: string | null;
  generate: () => Promise<MappingSuggestionMutationOutcome>;
  accept: (suggestionId: string, baseRevision: number) => Promise<MappingSuggestionMutationOutcome>;
  reject: (suggestionId: string) => Promise<MappingSuggestionMutationOutcome>;
  acceptBatch: (suggestionIds: string[], baseRevision: number) => Promise<MappingSuggestionMutationOutcome>;
}

/** Real Mapping Assistant state for one project - fetched only by the Scene Mapping tab, on demand, same pattern as use-project-assets.ts/use-work-map.ts. */
export function useMappingSuggestions(projectId: string): MappingSuggestionsState {
  const [suggestions, setSuggestions] = useState<MappingSuggestion[] | null>(null);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [sceneEvidenceAvailability, setSceneEvidenceAvailability] = useState<Record<string, SceneEvidenceStatus>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchMappingSuggestions(projectId);
    if (result.ok) {
      setSuggestions(result.data.suggestions);
      setAiAvailable(result.data.aiAvailable);
      setSceneEvidenceAvailability(result.data.sceneEvidenceAvailability);
      setError(null);
    } else {
      setError(result.message);
    }
    setIsLoading(false);
  }, [projectId]);

  useEffect(() => {
    // load() only calls setState after its own first `await` - same accepted pattern as use-project-workspace.ts's own effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const generate = useCallback(async (): Promise<MappingSuggestionMutationOutcome> => {
    setIsGenerating(true);
    const result = await generateMappingSuggestions(projectId);
    setIsGenerating(false);
    if (result.ok) {
      setSuggestions(result.data.suggestions);
      setAiAvailable(result.data.aiAvailable);
      setSceneEvidenceAvailability(result.data.sceneEvidenceAvailability);
      return { ok: true };
    }
    return { ok: false, message: result.message };
  }, [projectId]);

  const accept = useCallback(
    async (suggestionId: string, baseRevision: number): Promise<MappingSuggestionMutationOutcome> => {
      const result = await acceptMappingSuggestion(projectId, suggestionId, baseRevision);
      if (!result.ok) {
        return { ok: false, message: result.message };
      }
      await load();
      return { ok: true, executionPlan: result.data.executionPlan };
    },
    [projectId, load]
  );

  const reject = useCallback(
    async (suggestionId: string): Promise<MappingSuggestionMutationOutcome> => {
      const result = await rejectMappingSuggestion(projectId, suggestionId);
      if (!result.ok) {
        return { ok: false, message: result.message };
      }
      await load();
      return { ok: true };
    },
    [projectId, load]
  );

  const acceptBatch = useCallback(
    async (suggestionIds: string[], baseRevision: number): Promise<MappingSuggestionMutationOutcome> => {
      const result = await batchAcceptMappingSuggestions(projectId, suggestionIds, baseRevision);
      if (!result.ok) {
        return { ok: false, message: result.message };
      }
      await load();
      return { ok: true, executionPlan: result.data.executionPlan };
    },
    [projectId, load]
  );

  return {
    suggestions,
    aiAvailable,
    sceneEvidenceAvailability,
    isLoading,
    isGenerating,
    error,
    generate,
    accept,
    reject,
    acceptBatch
  };
}
