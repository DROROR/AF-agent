"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode
} from "react";
import {
  readStoredWorkspaceMode,
  writeStoredWorkspaceMode,
  type WorkspaceMode
} from "../lib/workspace-mode";

interface WorkspaceModeContextValue {
  mode: WorkspaceMode;
  setMode: (mode: WorkspaceMode) => void;
}

const WorkspaceModeContext = createContext<WorkspaceModeContextValue | null>(null);

/**
 * Simple/Advanced toggle (client-facing UX redesign, sections H/I) -
 * always renders "simple" for the first paint (server and client agree,
 * no hydration mismatch), then picks up this device's stored preference
 * right after mount. Never removes or gates any capability itself - it
 * only lets ProjectWorkspaceShell/ProjectScenesTab/ProjectWorkMapTab
 * choose which of their own already-existing views to show.
 */
export function WorkspaceModeProvider({ children }: { children: ReactNode }): ReactElement {
  const [mode, setModeState] = useState<WorkspaceMode>("simple");

  // setModeState only ever runs after this async function's own await -
  // never synchronously at the top of the effect (same pattern as
  // use-project-workspace.ts's own load()/`void load()` trigger).
  useEffect(() => {
    let cancelled = false;
    async function syncFromStorage(): Promise<void> {
      await Promise.resolve();
      if (cancelled) return;
      const stored = readStoredWorkspaceMode();
      if (stored) {
        setModeState(stored);
      }
    }
    void syncFromStorage();
    return () => {
      cancelled = true;
    };
  }, []);

  function setMode(next: WorkspaceMode): void {
    setModeState(next);
    writeStoredWorkspaceMode(next);
  }

  return (
    <WorkspaceModeContext.Provider value={{ mode, setMode }}>
      {children}
    </WorkspaceModeContext.Provider>
  );
}

export function useWorkspaceMode(): WorkspaceModeContextValue {
  const context = useContext(WorkspaceModeContext);
  if (!context) {
    throw new Error("useWorkspaceMode must be used within a WorkspaceModeProvider");
  }
  return context;
}
