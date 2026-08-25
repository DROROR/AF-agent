"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { clearStoredTheme, readStoredTheme, systemPrefersDark, writeStoredTheme, type Theme } from "../lib/theme";

interface ThemeContextValue {
  theme: Theme;
  /** True once the user has explicitly picked a theme on this device, rather than it being derived from the OS preference. */
  isExplicit: boolean;
  setTheme: (theme: Theme) => void;
  /** Clears the explicit preference and follows the OS setting again. */
  useSystemTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Applies the theme to <html data-theme="..."> and persists it. The
 * INITIAL value for first paint is set by a blocking inline script in
 * layout.tsx (see ANTI_FLASH_SCRIPT there) - this provider picks up
 * whatever that script already applied via the DOM attribute itself,
 * rather than re-deciding and risking a flash/mismatch.
 */
export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document === "undefined") {
      return "light";
    }
    const domTheme = document.documentElement.getAttribute("data-theme");
    return domTheme === "dark" ? "dark" : "light";
  });
  const [isExplicit, setIsExplicit] = useState(() => (typeof window === "undefined" ? false : readStoredTheme() !== null));

  const applyTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.setAttribute("data-theme", next);
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      writeStoredTheme(next);
      setIsExplicit(true);
      applyTheme(next);
    },
    [applyTheme]
  );

  const useSystemTheme = useCallback(() => {
    clearStoredTheme();
    setIsExplicit(false);
    applyTheme(systemPrefersDark() ? "dark" : "light");
  }, [applyTheme]);

  // If the user has never explicitly chosen a theme on this device,
  // follow the OS preference live rather than freezing at whatever it was
  // on first load.
  useEffect(() => {
    if (readStoredTheme() !== null) {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent): void => {
      if (readStoredTheme() !== null) {
        return;
      }
      applyTheme(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [applyTheme]);

  const value = useMemo(() => ({ theme, isExplicit, setTheme, useSystemTheme }), [theme, isExplicit, setTheme, useSystemTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
