import { describe, expect, it } from "vitest";
import { localeAntiFlashScript } from "./locale-anti-flash-script";
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY } from "./locale";

describe("localeAntiFlashScript", () => {
  it("embeds the exact storage key and default locale as JSON string literals", () => {
    const script = localeAntiFlashScript(LOCALE_STORAGE_KEY, DEFAULT_LOCALE);
    expect(script).toContain(JSON.stringify(LOCALE_STORAGE_KEY));
    expect(script).toContain(JSON.stringify(DEFAULT_LOCALE));
  });

  it("applies a stored Hebrew preference: sets lang=he and dir=rtl", () => {
    const script = localeAntiFlashScript(LOCALE_STORAGE_KEY, DEFAULT_LOCALE);
    const calls: [string, string][] = [];
    const fakeDocument = {
      documentElement: { setAttribute: (name: string, value: string) => calls.push([name, value]) }
    };
    const fakeLocalStorage = { getItem: () => "he" };
    const fakeNavigator = { languages: ["en-US"], language: "en-US" };

    const run = new Function("document", "localStorage", "navigator", script);
    expect(() => run(fakeDocument, fakeLocalStorage, fakeNavigator)).not.toThrow();
    expect(calls).toEqual([
      ["lang", "he"],
      ["dir", "rtl"]
    ]);
  });

  it("applies a stored English preference: sets lang=en and dir=ltr", () => {
    const script = localeAntiFlashScript(LOCALE_STORAGE_KEY, DEFAULT_LOCALE);
    const calls: [string, string][] = [];
    const fakeDocument = {
      documentElement: { setAttribute: (name: string, value: string) => calls.push([name, value]) }
    };
    const fakeLocalStorage = { getItem: () => "en" };
    const fakeNavigator = { languages: ["he-IL"], language: "he-IL" };

    const run = new Function("document", "localStorage", "navigator", script);
    run(fakeDocument, fakeLocalStorage, fakeNavigator);
    expect(calls).toEqual([
      ["lang", "en"],
      ["dir", "ltr"]
    ]);
  });

  it("falls back to browser-language detection only when nothing is stored", () => {
    const script = localeAntiFlashScript(LOCALE_STORAGE_KEY, DEFAULT_LOCALE);
    const calls: [string, string][] = [];
    const fakeDocument = {
      documentElement: { setAttribute: (name: string, value: string) => calls.push([name, value]) }
    };
    const fakeLocalStorage = { getItem: () => null };
    const fakeNavigator = { languages: ["he-IL", "en-US"], language: "he-IL" };

    const run = new Function("document", "localStorage", "navigator", script);
    run(fakeDocument, fakeLocalStorage, fakeNavigator);
    expect(calls).toEqual([
      ["lang", "he"],
      ["dir", "rtl"]
    ]);
  });

  it("falls back to the English default when nothing is stored and the browser isn't Hebrew", () => {
    const script = localeAntiFlashScript(LOCALE_STORAGE_KEY, DEFAULT_LOCALE);
    const calls: [string, string][] = [];
    const fakeDocument = {
      documentElement: { setAttribute: (name: string, value: string) => calls.push([name, value]) }
    };
    const fakeLocalStorage = { getItem: () => null };
    const fakeNavigator = { languages: ["fr-FR"], language: "fr-FR" };

    const run = new Function("document", "localStorage", "navigator", script);
    run(fakeDocument, fakeLocalStorage, fakeNavigator);
    expect(calls).toEqual([
      ["lang", "en"],
      ["dir", "ltr"]
    ]);
  });

  it("never throws even if localStorage access itself throws", () => {
    const script = localeAntiFlashScript(LOCALE_STORAGE_KEY, DEFAULT_LOCALE);
    const fakeDocument = { documentElement: { setAttribute: () => {} } };
    const fakeLocalStorage = {
      getItem: () => {
        throw new Error("blocked");
      }
    };
    const run = new Function("document", "localStorage", "navigator", script);
    expect(() => run(fakeDocument, fakeLocalStorage, {})).not.toThrow();
  });
});
