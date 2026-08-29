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

  it("uses each provider's own REAL brand color, never currentColor/theme-adapted - shown exactly as the brand specifies, regardless of dark/light mode", () => {
    const { container: openai } = render(<OpenAiLogo />);
    const { container: claude } = render(<ClaudeLogo />);
    const { container: gemini } = render(<GeminiLogo />);

    expect(openai.querySelector("svg")?.getAttribute("fill")).toBe("#000000");
    expect(claude.querySelector("svg")?.getAttribute("fill")).toBe("#D97757");
    // Gemini has no single flat fill - it's a blue base plus green/red/yellow
    // gradient highlights, never a flat/monochrome recoloring.
    const geminiPaths = gemini.querySelectorAll("path");
    expect(geminiPaths[0]?.getAttribute("fill")).toBe("#3186FF");
    expect(gemini.querySelectorAll("linearGradient")).toHaveLength(3);
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
