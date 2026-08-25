// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LOCALE,
  detectBrowserLocale,
  directionFor,
  isLocale,
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  resolveInitialLocale,
  writeStoredLocale
} from "./locale";

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: () => null,
    length: store.size
  } as Storage;
}

describe("isLocale", () => {
  it("accepts exactly 'en' and 'he'", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("he")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe("directionFor", () => {
  it("en => ltr", () => {
    expect(directionFor("en")).toBe("ltr");
  });

  it("he => rtl", () => {
    expect(directionFor("he")).toBe("rtl");
  });
});

describe("readStoredLocale / writeStoredLocale", () => {
  it("round-trips a written locale", () => {
    const storage = fakeStorage();
    writeStoredLocale("he", storage);
    expect(readStoredLocale(storage)).toBe("he");
  });

  it("returns null when nothing is stored", () => {
    expect(readStoredLocale(fakeStorage())).toBeNull();
  });

  it("returns null (never throws) for a corrupted/unexpected stored value", () => {
    expect(readStoredLocale(fakeStorage({ [LOCALE_STORAGE_KEY]: "fr" }))).toBeNull();
  });

  it("never throws when storage access itself throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    };
    expect(() => readStoredLocale(throwing)).not.toThrow();
    expect(() => writeStoredLocale("he", throwing)).not.toThrow();
  });
});

describe("detectBrowserLocale", () => {
  it("matches a Hebrew browser language to he", () => {
    expect(detectBrowserLocale(["he-IL", "en-US"])).toBe("he");
    expect(detectBrowserLocale(["he"])).toBe("he");
  });

  it("falls back to the English default for any non-Hebrew language", () => {
    expect(detectBrowserLocale(["en-US"])).toBe(DEFAULT_LOCALE);
    expect(detectBrowserLocale(["fr-FR", "de-DE"])).toBe(DEFAULT_LOCALE);
    expect(detectBrowserLocale([])).toBe(DEFAULT_LOCALE);
  });

  it("defaults to reading the real navigator.languages when none are given", () => {
    vi.stubGlobal("navigator", { languages: ["he-IL"], language: "he-IL" });
    expect(detectBrowserLocale()).toBe("he");
    vi.unstubAllGlobals();
  });
});

describe("resolveInitialLocale", () => {
  it("prefers a stored preference over browser detection", () => {
    const storage = fakeStorage({ [LOCALE_STORAGE_KEY]: "en" });
    expect(resolveInitialLocale(storage, ["he-IL"])).toBe("en");
  });

  it("falls back to browser detection only when nothing is stored (never otherwise)", () => {
    const storage = fakeStorage();
    expect(resolveInitialLocale(storage, ["he-IL"])).toBe("he");
    expect(resolveInitialLocale(storage, ["fr-FR"])).toBe(DEFAULT_LOCALE);
  });
});
