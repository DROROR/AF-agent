"use client";

import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import { useProjectWorkspace, type ProjectWorkspaceState } from "../lib/use-project-workspace";

const ProjectWorkspaceContext = createContext<ProjectWorkspaceState | null>(null);

/**
 * One shared workspace load per project route (Overview/Scenes/Revisions
 * tabs all read the same project+plan state) - mirrors
 * DashboardStatusProvider's "lift the fetch once" role, but for an
 * on-demand per-project workspace rather than a polling app-wide monitor.
 */
export function ProjectWorkspaceProvider({ projectId, children }: { projectId: string; children: ReactNode }): ReactElement {
  const state = useProjectWorkspace(projectId);
  return <ProjectWorkspaceContext.Provider value={state}>{children}</ProjectWorkspaceContext.Provider>;
}

export function useProjectWorkspaceContext(): ProjectWorkspaceState {
  const context = useContext(ProjectWorkspaceContext);
  if (!context) {
    throw new Error("useProjectWorkspaceContext must be used within a ProjectWorkspaceProvider");
  }
  return context;
}
