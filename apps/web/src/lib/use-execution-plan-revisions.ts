"use client";

import { useEffect, useState } from "react";
import type { ExecutionPlanRevisionSummary } from "@dyo/schemas";
import { fetchExecutionPlanRevisions } from "./projects-api-client";

export interface UseExecutionPlanRevisionsResult {
  revisions: ExecutionPlanRevisionSummary[] | null;
  isLoading: boolean;
  error: string | null;
}

/** Fetched only by the Revisions tab, on demand - not part of the shared ProjectWorkspaceProvider load, since most workspace visits never open this tab. */
export function useExecutionPlanRevisions(projectId: string): UseExecutionPlanRevisionsResult {
  const [revisions, setRevisions] = useState<ExecutionPlanRevisionSummary[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // No setState synchronously in the effect body - see
    // use-project-workspace.ts's load() for why (react-hooks/set-state-in-effect).
    void fetchExecutionPlanRevisions(projectId).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setRevisions(result.data.revisions);
        setError(null);
      } else if (result.status === 404) {
        setRevisions([]);
        setError(null);
      } else {
        setError(result.message);
      }
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { revisions, isLoading, error };
}
