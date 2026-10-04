"use client";

import { useEffect, useState } from "react";
import type { JobHistoryEntryDto } from "@dyo/schemas";
import { fetchJobHistory } from "./projects-api-client";

export interface UseJobHistoryResult {
  jobs: JobHistoryEntryDto[] | null;
  isLoading: boolean;
  error: string | null;
  /** Rows the server sent that could not be read, and so are not in `jobs` - reported, never silently dropped. */
  unreadableCount: number;
}

/** Fetched once when the Jobs page mounts - "job history + errors" (2026-08-29 closure requirement). */
export function useJobHistory(): UseJobHistoryResult {
  const [jobs, setJobs] = useState<JobHistoryEntryDto[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadableCount, setUnreadableCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchJobHistory().then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setJobs(result.data.jobs);
        setUnreadableCount(result.data.unreadableCount);
        setError(null);
      } else {
        setError(result.message);
      }
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { jobs, isLoading, error, unreadableCount };
}
