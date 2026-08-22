import { describe, expect, it } from "vitest";
import type { ProcessLister, ProcessRunningStatus } from "../infrastructure/process-lister.js";
import { detectAeHealth } from "./ae-health.js";

function fakeProcessLister(status: ProcessRunningStatus): ProcessLister {
  return {
    isImageRunning: async () => status
  };
}

describe("detectAeHealth", () => {
  it("reports UNKNOWN with no version when AE_PATH is not configured", async () => {
    const result = await detectAeHealth(
      { aePath: undefined, aerenderPath: undefined },
      fakeProcessLister("UNKNOWN")
    );
    expect(result).toEqual({ aeStatus: "UNKNOWN", aeVersion: null, aerenderAvailable: false });
  });

  it("reports ONLINE when the process check finds AfterFX.exe running", async () => {
    const result = await detectAeHealth(
      { aePath: "C:\\Program Files\\Adobe\\Adobe After Effects 2026", aerenderPath: undefined },
      fakeProcessLister("RUNNING")
    );
    expect(result.aeStatus).toBe("ONLINE");
    expect(result.aeVersion).toBe("2026");
  });

  it("reports OFFLINE when the process check finds it not running", async () => {
    const result = await detectAeHealth(
      { aePath: "C:\\Program Files\\Adobe\\Adobe After Effects 2026", aerenderPath: undefined },
      fakeProcessLister("NOT_RUNNING")
    );
    expect(result.aeStatus).toBe("OFFLINE");
  });

  it("reports UNKNOWN, never fabricating a status, when the process check itself is unreliable", async () => {
    const result = await detectAeHealth(
      { aePath: "C:\\Program Files\\Adobe\\Adobe After Effects 2026", aerenderPath: undefined },
      fakeProcessLister("UNKNOWN")
    );
    expect(result.aeStatus).toBe("UNKNOWN");
  });

  it("reports aerenderAvailable false when no aerenderPath is configured", async () => {
    const result = await detectAeHealth(
      { aePath: undefined, aerenderPath: undefined },
      fakeProcessLister("UNKNOWN")
    );
    expect(result.aerenderAvailable).toBe(false);
  });

  it("reports aerenderAvailable false when the configured path does not exist on disk", async () => {
    const result = await detectAeHealth(
      { aePath: undefined, aerenderPath: "/nonexistent/aerender.exe" },
      fakeProcessLister("UNKNOWN")
    );
    expect(result.aerenderAvailable).toBe(false);
  });

  it("returns null aeVersion when the path has no recognizable year", async () => {
    const result = await detectAeHealth(
      { aePath: "/opt/after-effects", aerenderPath: undefined },
      fakeProcessLister("UNKNOWN")
    );
    expect(result.aeVersion).toBeNull();
  });
});
