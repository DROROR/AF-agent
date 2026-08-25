"use client";

import { Moon, Sun } from "lucide-react";
import type { ReactElement } from "react";
import { useLocale } from "./LocaleProvider";
import { useTheme } from "./ThemeProvider";
import { otherTheme } from "../lib/theme";

export function ThemeToggle(): ReactElement {
  const { theme, setTheme } = useTheme();
  const { t } = useLocale();
  const next = otherTheme(theme);
  const nextLabel = next === "dark" ? t.settings.themeDark : t.settings.themeLight;
  const label = t.common.switchToTheme(nextLabel);

  return (
    <button type="button" className="topbar__icon-button" onClick={() => setTheme(next)} aria-label={label} title={label}>
      {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  );
}
