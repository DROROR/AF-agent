// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClaudeLogo, GeminiLogo, OpenAiLogo } from "./ProviderLogos";

describe("ProviderLogos", () => {
  it("renders real, distinct brand marks for OpenAI, Claude, and Gemini - never the same placeholder path", () => {
    const { container: openai } = render(<OpenAiLogo />);
    const { container: claude } = render(<ClaudeLogo />);
    const { container: gemini } = render(<GeminiLogo />);

    const openaiPath = openai.querySelector("path")?.getAttribute("d");
    const claudePath = claude.querySelector("path")?.getAttribute("d");
    const geminiPath = gemini.querySelector("path")?.getAttribute("d");

    expect(openaiPath).toBeTruthy();
    expect(claudePath).toBeTruthy();
    expect(geminiPath).toBeTruthy();
    expect(new Set([openaiPath, claudePath, geminiPath]).size).toBe(3);
  });

  it("uses currentColor, not a hardcoded brand color - adapts to this app's own dark/light theme like every other icon", () => {
    const { container } = render(<OpenAiLogo />);
    expect(container.querySelector("svg")?.getAttribute("fill")).toBe("currentColor");
  });

  it("defaults to size 22 (matching the row icons it replaces), and honors an explicit size override", () => {
    const { container: withDefault } = render(<ClaudeLogo />);
    const { container: withOverride } = render(<ClaudeLogo size={16} />);
    expect(withDefault.querySelector("svg")?.getAttribute("width")).toBe("22");
    expect(withOverride.querySelector("svg")?.getAttribute("width")).toBe("16");
  });

  it("is purely presentational when aria-hidden is passed (never a duplicate accessible name next to the row's own visible label)", () => {
    const { container } = render(<GeminiLogo aria-hidden="true" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.hasAttribute("aria-label")).toBe(false);
  });
});
