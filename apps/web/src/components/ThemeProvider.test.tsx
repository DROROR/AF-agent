// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "./LocaleProvider";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { ThemeToggle } from "./ThemeToggle";
import { THEME_STORAGE_KEY } from "../lib/theme";

// jsdom does not implement matchMedia - ThemeProvider's live-system-preference
// effect calls it unconditionally on mount, so every test needs a stub.
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  vi.unstubAllGlobals();
});

function ThemeReadout(): ReactElement {
  const { theme, isExplicit } = useTheme();
  return (
    <span data-testid="readout">
      {theme}:{String(isExplicit)}
    </span>
  );
}

describe("ThemeProvider + ThemeToggle", () => {
  it("toggling applies the new theme to <html data-theme> and persists it", () => {
    document.documentElement.setAttribute("data-theme", "light");
    render(
      <ThemeProvider>
        <LocaleProvider>
          <ThemeToggle />
          <ThemeReadout />
        </LocaleProvider>
      </ThemeProvider>
    );

    expect(screen.getByTestId("readout").textContent).toBe("light:false");

    fireEvent.click(screen.getByRole("button", { name: /switch to dark theme/i }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByTestId("readout").textContent).toBe("dark:true");
  });

  it("toggling back to light updates both the DOM attribute and storage", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(
      <ThemeProvider>
        <LocaleProvider>
          <ThemeToggle />
        </LocaleProvider>
      </ThemeProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /switch to light theme/i }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("useTheme throws a clear error outside of a ThemeProvider", () => {
    // Suppress React's expected console.error for the thrown-during-render case.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ThemeReadout />)).toThrow(/useTheme must be used within a ThemeProvider/);
    spy.mockRestore();
  });
});
