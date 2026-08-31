export type WorkspaceMode = "simple" | "advanced";

const STORAGE_KEY = "dyo-workspace-mode";

/**
 * Client-facing UX redesign, section I: "preserve all technical
 * capabilities behind an Advanced access mode... never remove." Defaults
 * to "simple" for a non-technical client on a fresh browser/device; a
 * per-device preference only, never synced server-side - an operator who
 * flips to Advanced on their own machine never affects what a client sees
 * on theirs.
 */
export function readStoredWorkspaceMode(): WorkspaceMode | null {
  if (typeof window === "undefined") {
    return null;
  }
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === "advanced" ? "advanced" : value === "simple" ? "simple" : null;
}

export function writeStoredWorkspaceMode(mode: WorkspaceMode): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, mode);
}
