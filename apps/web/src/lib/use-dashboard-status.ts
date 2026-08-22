"use client";

import { useEffect, useState } from "react";
import type { DashboardStatus } from "./dashboard-types";

/** 10s balances freshness against not hammering the API - CLAUDE.md Phase 3 task 5. */
const DEFAULT_POLL_INTERVAL_MS = 10_000;

export interface UseDashboardStatusResult {
  data: DashboardStatus | null;
  isInitialLoading: boolean;
  /** Most recent poll failure, if any. `data` from an earlier successful poll is kept on screen rather than being wiped by a transient failure. */
  lastError: string | null;
}

export function useDashboardStatus(
  pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS
): UseDashboardStatusResult {
  const [data, setData] = useState<DashboardStatus | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll(): Promise<void> {
      try {
        const response = await fetch("/api/dashboard/status", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Dashboard status request failed (${response.status})`);
        }
        const json = (await response.json()) as DashboardStatus;
        if (!cancelled) {
          setData(json);
          setLastError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setLastError(error instanceof Error ? error.message : "Unknown error");
        }
      } finally {
        if (!cancelled) {
          setIsInitialLoading(false);
        }
      }
    }

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pollIntervalMs]);

  return { data, isInitialLoading, lastError };
}
