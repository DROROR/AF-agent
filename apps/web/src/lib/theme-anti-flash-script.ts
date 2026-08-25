import { THEME_STORAGE_KEY } from "./theme";

/**
 * Source for the blocking inline script in layout.tsx's <head> that sets
 * data-theme on <html> BEFORE first paint, so there is never a flash of
 * the wrong theme while React hydrates. Kept as a real, readable/testable
 * TypeScript function (not a hand-written string) and stringified once at
 * build time - see layout.tsx.
 *
 * Deliberately has no closure over any outer variable except the storage
 * key constant (inlined via string interpolation at use-site) - this
 * function's source is executed as raw text in the browser, not as an ES
 * module, so it cannot reference imports at runtime.
 */
export function themeAntiFlashScript(storageKey: string): string {
  return `(function() {
    try {
      var stored = localStorage.getItem(${JSON.stringify(storageKey)});
      var theme = stored === "dark" || stored === "light"
        ? stored
        : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      document.documentElement.setAttribute("data-theme", theme);
    } catch (e) {}
  })();`;
}

export const THEME_ANTI_FLASH_SCRIPT = themeAntiFlashScript(THEME_STORAGE_KEY);
