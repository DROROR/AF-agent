import { describe, expect, it } from "vitest";
import { deriveTelemetryAvailability } from "./derive-telemetry-availability.js";

describe("deriveTelemetryAvailability", () => {
  it("passes through the reported status when the worker is ONLINE", () => {
    expect(deriveTelemetryAvailability("ONLINE", "ONLINE")).toBe("ONLINE");
    expect(deriveTelemetryAvailability("ONLINE", "OFFLINE")).toBe("OFFLINE");
    expect(deriveTelemetryAvailability("ONLINE", "UNKNOWN")).toBe("UNKNOWN");
  });

  it("reports UNAVAILABLE whenever the worker is OFFLINE, regardless of the last-reported value", () => {
    expect(deriveTelemetryAvailability("OFFLINE", "ONLINE")).toBe("UNAVAILABLE");
    expect(deriveTelemetryAvailability("OFFLINE", "OFFLINE")).toBe("UNAVAILABLE");
    expect(deriveTelemetryAvailability("OFFLINE", "UNKNOWN")).toBe("UNAVAILABLE");
  });
});
