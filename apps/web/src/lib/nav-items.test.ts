import { describe, expect, it } from "vitest";
import { NAV_ITEMS, findActiveNavItem } from "./nav-items";

describe("findActiveNavItem", () => {
  it("matches the Overview item only for the exact root path", () => {
    expect(findActiveNavItem("/")?.label).toBe("Overview");
    expect(findActiveNavItem("/workers")?.label).not.toBe("Overview");
  });

  it("matches a top-level route exactly", () => {
    expect(findActiveNavItem("/workers")?.label).toBe("Workers");
    expect(findActiveNavItem("/jobs")?.label).toBe("Jobs / Queue");
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
