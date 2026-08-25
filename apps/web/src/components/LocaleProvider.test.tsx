// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider, useLocale } from "./LocaleProvider";
import { LOCALE_STORAGE_KEY } from "../lib/i18n/locale";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("lang");
  document.documentElement.removeAttribute("dir");
});

function LocaleReadout(): ReactElement {
  const { locale, dir, setLocale } = useLocale();
  return (
    <div>
      <span data-testid="readout">
        {locale}:{dir}
      </span>
      <button type="button" onClick={() => setLocale("he")}>
        switch to he
      </button>
      <button type="button" onClick={() => setLocale("en")}>
        switch to en
      </button>
    </div>
  );
}

describe("LocaleProvider", () => {
  it("en => dir=ltr on <html>, and the context reports it too", () => {
    document.documentElement.setAttribute("lang", "en");
    render(
      <LocaleProvider>
        <LocaleReadout />
      </LocaleProvider>
    );

    expect(screen.getByTestId("readout").textContent).toBe("en:ltr");
    expect(document.documentElement.getAttribute("lang")).toBe("en");
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
  });

  it("he => dir=rtl on <html>, and the context reports it too", () => {
    document.documentElement.setAttribute("lang", "he");
    render(
      <LocaleProvider>
        <LocaleReadout />
      </LocaleProvider>
    );

    expect(screen.getByTestId("readout").textContent).toBe("he:rtl");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
  });

  it("switching locale updates <html lang/dir>, persists to localStorage, and updates the context value (language persistence)", () => {
    document.documentElement.setAttribute("lang", "en");
    render(
      <LocaleProvider>
        <LocaleReadout />
      </LocaleProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "switch to he" }));

    expect(document.documentElement.getAttribute("lang")).toBe("he");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("he");
    expect(screen.getByTestId("readout").textContent).toBe("he:rtl");
  });

  it("switching back to en restores ltr and the persisted preference", () => {
    document.documentElement.setAttribute("lang", "he");
    render(
      <LocaleProvider>
        <LocaleReadout />
      </LocaleProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "switch to en" }));

    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
  });

  it("useLocale throws a clear error outside of a LocaleProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<LocaleReadout />)).toThrow(/useLocale must be used within a LocaleProvider/);
    spy.mockRestore();
  });
});
