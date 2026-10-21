export type WorkspaceMode = "simple" | "advanced";

const STORAGE_KEY = "dyo-workspace-mode";
const TECHNICAL_SCREENS_KEY = "dyo-technical-screens";

/**
 * 2026-10-21 simplification: the Simple/Advanced switch is shown on a
 * project only after "Technical screens" is switched on in Settings (per
 * device). Without it a stored "advanced" is ignored, so a client who once
 * opened the Advanced view and lost the switch is back on the Simple view.
 */
export function readTechnicalScreensEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(TECHNICAL_SCREENS_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeTechnicalScreensEnabled(enabled: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (enabled) {
      window.localStorage.setItem(TECHNICAL_SCREENS_KEY, "on");
    } else {
      window.localStorage.removeItem(TECHNICAL_SCREENS_KEY);
    }
  } catch {
    // Storage unavailable - the switch simply does not persist.
  }
}

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
  if (value === "advanced") {
    return readTechnicalScreensEnabled() ? "advanced" : "simple";
  }
  return value === "simple" ? "simple" : null;
}

export function writeStoredWorkspaceMode(mode: WorkspaceMode): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, mode);
}
