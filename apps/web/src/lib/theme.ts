/**
 * Pure theme logic - no DOM/React here, so it's directly unit-testable and
 * safe to import from both the anti-flash inline script (as a string, see
 * layout.tsx) and ThemeProvider.
 */
export const THEME_STORAGE_KEY = "dyo-dashboard-theme";

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** Reads the persisted preference. Never throws - a disabled/unavailable localStorage (private browsing, etc.) just means no persisted preference, not a crash. */
export function readStoredTheme(storage: Pick<Storage, "getItem"> = localStorage): Theme | null {
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredTheme(theme: Theme, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Best-effort persistence only - a failed write just means the
    // preference will be re-derived from system preference next load.
  }
}

/** Clears the explicit preference so the app follows the OS setting again - see ThemeProvider's "System" option. */
export function clearStoredTheme(storage: Pick<Storage, "removeItem"> = localStorage): void {
  try {
    storage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Best-effort only.
  }
}

export function systemPrefersDark(media: Pick<MediaQueryList, "matches"> = window.matchMedia("(prefers-color-scheme: dark)")): boolean {
  return media.matches;
}

export function otherTheme(theme: Theme): Theme {
  return theme === "light" ? "dark" : "light";
}
