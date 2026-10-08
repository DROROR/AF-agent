"use client";

import { useCallback, useEffect, useState } from "react";
import type { WorkMap, WorkMapEntry } from "@dyo/schemas";
import { createAiWorkMapDraft, fetchWorkMap, updateWorkMap as saveWorkMap, type ApiResult } from "./projects-api-client";
import { settleAiWorkMapDraft } from "./ai-draft-settle";

export interface WorkMapMutationOutcome {
  ok: boolean;
  message?: string;
}

export interface WorkMapState {
  workMap: WorkMap | null;
  isLoading: boolean;
  error: string | null;
  /** Set only after a save is refused for a stale baseRevision (409 CONFLICT) - same recovery pattern as ProjectWorkspaceProvider's isStale. */
  isStale: boolean;
  refetch: () => Promise<void>;
  save: (entries: Array<Omit<WorkMapEntry, "id"> & { id?: string }>) => Promise<WorkMapMutationOutcome>;
  /** "Tell AI what you want" - real single Anthropic call (see createAiWorkMapDraft's own doc comment). Never touches the execution plan or Mapping Assistant suggestions. */
  createAiDraft: (instructions: string) => Promise<WorkMapMutationOutcome>;
}

/** Real client-INTENT Work Map state for one project - null is a valid, real "nothing saved yet" state (see get-work-map.ts), never a load error. */
export function useWorkMap(projectId: string): WorkMapState {
  const [workMap, setWorkMap] = useState<WorkMap | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchWorkMap(projectId);
    if (result.ok) {
      setWorkMap(result.data);
      setError(null);
    } else {
      setError(result.message);
    }
    setIsStale(false);
    setIsLoading(false);
  }, [projectId]);

  useEffect(() => {
    // load() only calls setState after its own first `await` - same
    // accepted pattern as use-project-workspace.ts's own effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const save = useCallback(
    async (entries: Array<Omit<WorkMapEntry, "id"> & { id?: string }>): Promise<WorkMapMutationOutcome> => {
      const baseRevision = workMap?.revision ?? 0;
      const result: ApiResult<WorkMap> = await saveWorkMap(projectId, baseRevision, entries);
      if (result.ok) {
        setWorkMap(result.data);
        setIsStale(false);
        return { ok: true };
      }
      if (result.code === "CONFLICT") {
        setIsStale(true);
      }
      return { ok: false, message: result.message };
    },
    [projectId, workMap]
  );

  const createAiDraft = useCallback(
    async (instructions: string): Promise<WorkMapMutationOutcome> => {
      // The revision from BEFORE the request, read fresh from the server
      // so a draft finished after the browser stopped waiting is
      // recognised by its newer revision (ai-draft-settle.ts). If that
      // read fails, the state's own revision is the best baseline there is.
      const before = await fetchWorkMap(projectId);
      const baselineRevision = before.ok ? (before.data?.revision ?? 0) : (workMap?.revision ?? 0);
      const result: ApiResult<WorkMap> = await settleAiWorkMapDraft(baselineRevision, {
        post: () => createAiWorkMapDraft(projectId, instructions),
        poll: () => fetchWorkMap(projectId),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now()
      });
      if (result.ok) {
        setWorkMap(result.data);
        setIsStale(false);
        return { ok: true };
      }
      return { ok: false, message: result.message };
    },
    [projectId, workMap]
  );

  return { workMap, isLoading, error, isStale, refetch: load, save, createAiDraft };
}
