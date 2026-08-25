// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LanguageToggle } from "./LanguageToggle";
import { renderWithLocale } from "../test-utils/render-with-locale";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("lang");
  document.documentElement.removeAttribute("dir");
});

describe("LanguageToggle", () => {
  it("marks the active locale's own button as pressed", () => {
    renderWithLocale(<LanguageToggle />, { locale: "en" });
    expect(screen.getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "עברית" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking עברית switches the document to Hebrew/RTL", () => {
    renderWithLocale(<LanguageToggle />, { locale: "en" });

    fireEvent.click(screen.getByRole("button", { name: "עברית" }));

    expect(document.documentElement.getAttribute("lang")).toBe("he");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
  });

  it("clicking English switches back to English/LTR", () => {
    renderWithLocale(<LanguageToggle />, { locale: "he" });

    fireEvent.click(screen.getByRole("button", { name: "English" }));

    expect(document.documentElement.getAttribute("lang")).toBe("en");
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
  });
});
