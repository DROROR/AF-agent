// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider, useLocale } from "./LocaleProvider";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { LOCALE_STORAGE_KEY } from "../lib/i18n/locale";
import { THEME_STORAGE_KEY } from "../lib/theme";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("lang");
  document.documentElement.removeAttribute("dir");
  vi.unstubAllGlobals();
});

function Readout(): ReactElement {
  const { theme, setTheme } = useTheme();
  const { locale, dir, setLocale } = useLocale();
  return (
    <div>
      <span data-testid="readout">
        {theme}:{locale}:{dir}
      </span>
      <button type="button" onClick={() => setTheme("dark")}>
        dark
      </button>
      <button type="button" onClick={() => setLocale("he")}>
        he
      </button>
    </div>
  );
}

/**
 * Theme and locale are two independent providers/contexts (see layout.tsx)
 * - this proves they actually compose correctly and don't clobber each
 * other's DOM attributes or state when both are exercised together.
 */
describe("ThemeProvider + LocaleProvider together", () => {
  it("switching locale to Hebrew does not change the theme, and vice versa", () => {
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.setAttribute("lang", "en");
    render(
      <ThemeProvider>
        <LocaleProvider>
          <Readout />
        </LocaleProvider>
      </ThemeProvider>
    );

    expect(screen.getByTestId("readout").textContent).toBe("light:en:ltr");

    fireEvent.click(screen.getByRole("button", { name: "he" }));
    expect(screen.getByTestId("readout").textContent).toBe("light:he:rtl");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    fireEvent.click(screen.getByRole("button", { name: "dark" }));
    expect(screen.getByTestId("readout").textContent).toBe("dark:he:rtl");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("he");
  });
});
