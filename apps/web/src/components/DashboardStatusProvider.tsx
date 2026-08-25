"use client";

import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import { useDashboardStatus, type UseDashboardStatusResult } from "../lib/use-dashboard-status";

const DashboardStatusContext = createContext<UseDashboardStatusResult | null>(null);

/**
 * Single shared poller for the whole app shell - useDashboardStatus already
 * polls /api/dashboard/status every 10s and preserves last-good data across
 * a transient failure (see that file). Without this provider, every page/
 * component that needs this data (TopBar's health dot, Overview, Workers)
 * would run its own independent 10s interval against the same endpoint -
 * this lifts it once so they share one poll.
 */
export function DashboardStatusProvider({ children }: { children: ReactNode }): ReactElement {
  const status = useDashboardStatus();
  return <DashboardStatusContext.Provider value={status}>{children}</DashboardStatusContext.Provider>;
}

export function useDashboardStatusContext(): UseDashboardStatusResult {
  const context = useContext(DashboardStatusContext);
  if (!context) {
    throw new Error("useDashboardStatusContext must be used within a DashboardStatusProvider");
  }
  return context;
}
