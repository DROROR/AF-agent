// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { clearStoredTheme, isTheme, otherTheme, readStoredTheme, systemPrefersDark, writeStoredTheme } from "./theme";

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

describe("isTheme", () => {
  it("accepts exactly 'light' and 'dark'", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
  });

  it("rejects anything else, including a plausible-looking value like 'system'", () => {
    expect(isTheme("system")).toBe(false);
    expect(isTheme("")).toBe(false);
    expect(isTheme(null)).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(isTheme(1)).toBe(false);
  });
});

describe("readStoredTheme / writeStoredTheme / clearStoredTheme", () => {
  it("round-trips a written theme", () => {
    const storage = fakeStorage();
    writeStoredTheme("dark", storage);
    expect(readStoredTheme(storage)).toBe("dark");
  });

  it("returns null when nothing is stored", () => {
    expect(readStoredTheme(fakeStorage())).toBeNull();
  });

  it("returns null (never throws) for a corrupted/unexpected stored value", () => {
    expect(readStoredTheme(fakeStorage({ "dyo-dashboard-theme": "purple" }))).toBeNull();
  });

  it("clearStoredTheme removes the persisted value", () => {
    const storage = fakeStorage({ "dyo-dashboard-theme": "dark" });
    clearStoredTheme(storage);
    expect(readStoredTheme(storage)).toBeNull();
  });

  it("never throws when storage access itself throws (e.g. private browsing)", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      }
    };
    expect(() => readStoredTheme(throwing)).not.toThrow();
    expect(readStoredTheme(throwing)).toBeNull();
    expect(() => writeStoredTheme("dark", throwing)).not.toThrow();
    expect(() => clearStoredTheme(throwing)).not.toThrow();
  });
});

describe("otherTheme", () => {
  it("flips light <-> dark", () => {
    expect(otherTheme("light")).toBe("dark");
    expect(otherTheme("dark")).toBe("light");
  });
});

describe("systemPrefersDark", () => {
  it("reflects the given media query's matches value", () => {
    expect(systemPrefersDark({ matches: true })).toBe(true);
    expect(systemPrefersDark({ matches: false })).toBe(false);
  });

  it("defaults to querying the real (prefers-color-scheme: dark) media query", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal("matchMedia", matchMedia);
    expect(systemPrefersDark()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
    vi.unstubAllGlobals();
  });
});
