"use client";

import type { ReactElement } from "react";
import { useLocale } from "./LocaleProvider";
import { LOCALES, type Locale } from "../lib/i18n/locale";

/**
 * Each language's own name is shown in its own script regardless of the
 * currently active locale (standard language-switcher convention) - these
 * are not translated strings, they're the fixed labels/flags for this
 * control itself. Full words (not abbreviations), each paired with its
 * country flag.
 */
const LOCALE_LABEL: Record<Locale, string> = { en: "English", he: "עברית" };
const LOCALE_FLAG: Record<Locale, string> = { en: "🇺🇸", he: "🇮🇱" };

export interface LanguageToggleProps {
  className?: string;
}

export function LanguageToggle({ className }: LanguageToggleProps): ReactElement {
  const { locale, setLocale, t } = useLocale();

  return (
    <div className={["language-toggle", className].filter(Boolean).join(" ")} role="group" aria-label={t.common.language}>
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          className="language-toggle__option"
          data-active={option === locale}
          aria-pressed={option === locale}
          onClick={() => setLocale(option)}
        >
          <span className="language-toggle__flag" aria-hidden="true">
            {LOCALE_FLAG[option]}
          </span>
          {LOCALE_LABEL[option]}
        </button>
      ))}
    </div>
  );
}
