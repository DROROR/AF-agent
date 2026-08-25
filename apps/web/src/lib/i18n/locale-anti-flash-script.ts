import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY } from "./locale";

/**
 * Source for the blocking inline script in layout.tsx's <head> that sets
 * lang/dir on <html> BEFORE first paint - mirrors theme-anti-flash-script.ts
 * exactly, but for locale/direction instead of theme. Without this, a
 * Hebrew-preferring visitor would see a flash of LTR English layout before
 * React hydrates and flips it, which is far more jarring for RTL than the
 * theme case (fonts, alignment, and reading order all change, not just
 * colors).
 *
 * Deliberately has no closure over any outer variable except the storage
 * key/default locale constants (inlined via string interpolation at
 * use-site) - this function's source is executed as raw text in the
 * browser, not as an ES module.
 */
export function localeAntiFlashScript(storageKey: string, defaultLocale: string): string {
  return `(function() {
    try {
      var stored = localStorage.getItem(${JSON.stringify(storageKey)});
      var locale = stored === "he" || stored === "en"
        ? stored
        : ((navigator.languages || [navigator.language || ""]).some(function(l) {
            return String(l).toLowerCase().indexOf("he") === 0;
          }) ? "he" : ${JSON.stringify(defaultLocale)});
      document.documentElement.setAttribute("lang", locale);
      document.documentElement.setAttribute("dir", locale === "he" ? "rtl" : "ltr");
    } catch (e) {}
  })();`;
}

export const LOCALE_ANTI_FLASH_SCRIPT = localeAntiFlashScript(LOCALE_STORAGE_KEY, DEFAULT_LOCALE);
