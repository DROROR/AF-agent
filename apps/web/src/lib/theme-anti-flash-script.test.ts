import { describe, expect, it } from "vitest";
import { themeAntiFlashScript } from "./theme-anti-flash-script";
import { THEME_STORAGE_KEY } from "./theme";

describe("themeAntiFlashScript", () => {
  it("embeds the exact storage key as a JSON string literal, never string-concatenated unescaped", () => {
    const script = themeAntiFlashScript(THEME_STORAGE_KEY);
    expect(script).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });

  it("is a real, syntactically valid IIFE that runs without throwing given a minimal fake window/document/localStorage", () => {
    const script = themeAntiFlashScript(THEME_STORAGE_KEY);
    const setAttributeCalls: [string, string][] = [];
    const fakeDocument = {
      documentElement: {
        setAttribute: (name: string, value: string) => setAttributeCalls.push([name, value])
      }
    };
    const fakeLocalStorage = { getItem: () => "dark" };
    const fakeWindow = { matchMedia: () => ({ matches: false }) };

    // IS the anti-flash script's own real runtime behavior under test, via
    // the exact mechanism the browser itself uses (a literal inline
    // <script> tag), not app logic evaluating untrusted input.
    const run = new Function("document", "localStorage", "window", script);
    expect(() => run(fakeDocument, fakeLocalStorage, fakeWindow)).not.toThrow();
    expect(setAttributeCalls).toEqual([["data-theme", "dark"]]);
  });

  it("falls back to the system preference when nothing is stored", () => {
    const script = themeAntiFlashScript(THEME_STORAGE_KEY);
    const setAttributeCalls: [string, string][] = [];
    const fakeDocument = {
      documentElement: {
        setAttribute: (name: string, value: string) => setAttributeCalls.push([name, value])
      }
    };
    const fakeLocalStorage = { getItem: () => null };
    const fakeWindow = { matchMedia: () => ({ matches: true }) };

    const run = new Function("document", "localStorage", "window", script);
    run(fakeDocument, fakeLocalStorage, fakeWindow);
    expect(setAttributeCalls).toEqual([["data-theme", "dark"]]);
  });

  it("never throws even if localStorage access itself throws", () => {
    const script = themeAntiFlashScript(THEME_STORAGE_KEY);
    const fakeDocument = { documentElement: { setAttribute: () => {} } };
    const fakeLocalStorage = {
      getItem: () => {
        throw new Error("blocked");
      }
    };

    const run = new Function("document", "localStorage", "window", script);
    expect(() => run(fakeDocument, fakeLocalStorage, {})).not.toThrow();
  });
});
