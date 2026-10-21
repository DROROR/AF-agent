import { describe, expect, it } from "vitest";
import { NAV_ITEMS, findActiveNavItem } from "./nav-items";

describe("findActiveNavItem", () => {
  it("offers only Projects and Settings (2026-10-21 simplification)", () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual(["Projects", "Settings"]);
  });

  it("matches a top-level route exactly", () => {
    expect(findActiveNavItem("/settings")?.label).toBe("Settings");
    expect(findActiveNavItem("/projects")?.label).toBe("Projects");
  });

  it("matches a nested route to its parent nav item via longest-prefix match", () => {
    expect(findActiveNavItem("/projects/new")?.label).toBe("Projects");
  });

  it("returns undefined for a path with no matching nav item", () => {
    expect(findActiveNavItem("/does-not-exist")).toBeUndefined();
  });

  it("every nav item has a non-empty href and label", () => {
    for (const item of NAV_ITEMS) {
      expect(item.href.length).toBeGreaterThan(0);
      expect(item.label.length).toBeGreaterThan(0);
    }
  });
});
