"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { DICTIONARIES, type Dictionary } from "../lib/i18n/dictionaries";
import { DEFAULT_LOCALE, directionFor, isLocale, writeStoredLocale, type Locale } from "../lib/i18n/locale";

interface LocaleContextValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  setLocale: (locale: Locale) => void;
  /** The active dictionary - fully typed, so `t.nav.overview` etc. is a compile-time-checked lookup, never a missing-key runtime surprise. */
  t: Dictionary;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Applies the locale to <html lang dir> and persists it. The INITIAL value
 * for first paint is set by a blocking inline script in layout.tsx (see
 * LOCALE_ANTI_FLASH_SCRIPT) - this provider picks up whatever that script
 * already applied via the DOM attribute itself, rather than re-deciding and
 * risking a flash/mismatch - same pattern as ThemeProvider.
 */
export function LocaleProvider({ children }: { children: ReactNode }): ReactElement {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof document === "undefined") {
      return DEFAULT_LOCALE;
    }
    const domLocale = document.documentElement.getAttribute("lang");
    return isLocale(domLocale) ? domLocale : DEFAULT_LOCALE;
  });

  // Defense in depth beyond the anti-flash script: guarantees dir is
  // actually in sync with the resolved locale on mount, rather than
  // trusting the script always ran first (e.g. the attribute was somehow
  // missing/stale) - lang is read directly from the DOM above, but dir
  // wasn't otherwise re-asserted until the next explicit setLocale() call.
  useEffect(() => {
    document.documentElement.setAttribute("dir", directionFor(locale));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback((next: Locale) => {
    writeStoredLocale(next);
    setLocaleState(next);
    document.documentElement.setAttribute("lang", next);
    document.documentElement.setAttribute("dir", directionFor(next));
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      dir: directionFor(locale),
      setLocale,
      t: DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE]
    }),
    [locale, setLocale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return context;
}
