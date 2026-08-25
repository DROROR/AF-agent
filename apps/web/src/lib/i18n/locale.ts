/**
 * Pure locale logic - no DOM/React here, so it's directly unit-testable and
 * safe to import from both the anti-flash inline script (as a string, see
 * locale-anti-flash-script.ts) and LocaleProvider. Mirrors lib/theme.ts's
 * shape deliberately, so the two systems (theme, locale) behave predictably
 * the same way for anyone maintaining either.
 */
export const LOCALE_STORAGE_KEY = "dyo-dashboard-locale";

export const LOCALES = ["en", "he"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_DIRECTION: Record<Locale, "ltr" | "rtl"> = {
  en: "ltr",
  he: "rtl"
};

export function directionFor(locale: Locale): "ltr" | "rtl" {
  return LOCALE_DIRECTION[locale];
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Reads the persisted preference. Never throws - a disabled/unavailable localStorage (private browsing, etc.) just means no persisted preference, not a crash. */
export function readStoredLocale(storage: Pick<Storage, "getItem"> = localStorage): Locale | null {
  try {
    const value = storage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale: Locale, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Best-effort persistence only.
  }
}

/**
 * Browser-language detection - only ever used as a fallback when nothing is
 * stored yet (CLAUDE.md/task: "Browser-language detection may be used only
 * when no saved preference exists"). Matches "he"/"he-IL"/etc. to Hebrew;
 * everything else falls back to the English default rather than guessing.
 */
export function detectBrowserLocale(
  languages: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language]
): Locale {
  const matchesHebrew = languages.some((language) => language.toLowerCase().startsWith("he"));
  return matchesHebrew ? "he" : DEFAULT_LOCALE;
}

/** The effective locale for first paint: stored preference, else browser detection, else the English default. */
export function resolveInitialLocale(
  storage: Pick<Storage, "getItem"> = localStorage,
  languages?: readonly string[]
): Locale {
  return readStoredLocale(storage) ?? detectBrowserLocale(languages);
}
