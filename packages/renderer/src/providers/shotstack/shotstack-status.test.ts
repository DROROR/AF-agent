import { describe, expect, it } from "vitest";
import { mapShotstackStatus, SHOTSTACK_STATUSES } from "./shotstack-status.js";

describe("mapShotstackStatus", () => {
  it("maps queued to QUEUED", () => {
    expect(mapShotstackStatus("queued")).toBe("QUEUED");
  });

  it("maps preprocessing, fetching, rendering and saving all onto PROCESSING", () => {
    expect(mapShotstackStatus("preprocessing")).toBe("PROCESSING");
    expect(mapShotstackStatus("fetching")).toBe("PROCESSING");
    expect(mapShotstackStatus("rendering")).toBe("PROCESSING");
    expect(mapShotstackStatus("saving")).toBe("PROCESSING");
  });

  it("maps done to DONE", () => {
    expect(mapShotstackStatus("done")).toBe("DONE");
  });

  it("maps failed to FAILED", () => {
    expect(mapShotstackStatus("failed")).toBe("FAILED");
  });

  it("has a mapping for every documented Shotstack status with no gaps", () => {
    for (const status of SHOTSTACK_STATUSES) {
      expect(mapShotstackStatus(status)).toBeDefined();
    }
  });
});
