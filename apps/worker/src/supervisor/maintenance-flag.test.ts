import path from "node:path";
import { describe, expect, it } from "vitest";
import { isMaintenanceActive, maintenanceFlagPath } from "./maintenance-flag.js";

describe("maintenanceFlagPath", () => {
  it("resolves under workRoot/state/maintenance.flag", () => {
    // path.join, not a hardcoded separator - this test runs on Linux CI as
    // well as matching the real Windows worker's own path conventions.
    expect(maintenanceFlagPath("/work-root")).toBe(path.resolve("/work-root", "state", "maintenance.flag"));
  });
});

describe("isMaintenanceActive", () => {
  it("is true only when the flag file exists at the exact expected path", () => {
    const seen: string[] = [];
    const deps = {
      existsSync: (path: string) => {
        seen.push(path);
        return path === maintenanceFlagPath("/work-root");
      }
    };
    expect(isMaintenanceActive(deps, "/work-root")).toBe(true);
    expect(seen).toEqual([maintenanceFlagPath("/work-root")]);
  });

  it("is false when the flag file does not exist", () => {
    expect(isMaintenanceActive({ existsSync: () => false }, "/work-root")).toBe(false);
  });
});
