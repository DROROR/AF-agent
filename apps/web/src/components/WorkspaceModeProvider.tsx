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
  readTechnicalScreensEnabled,
  writeStoredWorkspaceMode,
  writeTechnicalScreensEnabled,
  type WorkspaceMode
} from "../lib/workspace-mode";

interface WorkspaceModeContextValue {
  mode: WorkspaceMode;
  setMode: (mode: WorkspaceMode) => void;
  /** Settings > "Technical screens" (per device): whether the Simple/Advanced switch is offered on projects at all. */
  technicalScreens: boolean;
  setTechnicalScreens: (enabled: boolean) => void;
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
  const [technicalScreens, setTechnicalScreensState] = useState(false);

  // setModeState only ever runs after this async function's own await -
  // never synchronously at the top of the effect (same pattern as
  // use-project-workspace.ts's own load()/`void load()` trigger).
  useEffect(() => {
    let cancelled = false;
    async function syncFromStorage(): Promise<void> {
      await Promise.resolve();
      if (cancelled) return;
      setTechnicalScreensState(readTechnicalScreensEnabled());
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

  function setTechnicalScreens(enabled: boolean): void {
    setTechnicalScreensState(enabled);
    writeTechnicalScreensEnabled(enabled);
    if (!enabled) {
      setMode("simple");
    }
  }

  return (
    <WorkspaceModeContext.Provider value={{ mode, setMode, technicalScreens, setTechnicalScreens }}>
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

/**
 * The mode when a provider is mounted, otherwise null - for the one caller
 * that sits above individual tabs and must not throw where no mode exists
 * (ProjectGuidanceProvider, 2026-10-04). Every screen that DISPLAYS by mode
 * keeps using useWorkspaceMode above.
 */
export function useWorkspaceModeIfPresent(): WorkspaceMode | null {
  return useContext(WorkspaceModeContext)?.mode ?? null;
}

/** The whole context when a provider is present (Settings reads the "Technical screens" switch through it), else null. */
export function useWorkspaceModeControlsIfPresent(): WorkspaceModeContextValue | null {
  return useContext(WorkspaceModeContext);
}
