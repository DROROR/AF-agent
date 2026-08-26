import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readWorkerBuildInfo } from "./version.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dyo-worker-build-info-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readWorkerBuildInfo", () => {
  it("reads a real commit/builtAt marker", async () => {
    await writeFile(
      join(dir, "BUILD_INFO.json"),
      JSON.stringify({ commit: "a".repeat(40), builtAt: "2026-08-26T00:00:00.000Z" }),
      "utf8"
    );
    expect(readWorkerBuildInfo(dir)).toEqual({ commit: "a".repeat(40), builtAt: "2026-08-26T00:00:00.000Z" });
  });

  it("returns null (never fabricates) when the marker file does not exist", () => {
    expect(readWorkerBuildInfo(dir)).toBeNull();
  });

  it("returns null when the marker is malformed JSON", async () => {
    await writeFile(join(dir, "BUILD_INFO.json"), "not json", "utf8");
    expect(readWorkerBuildInfo(dir)).toBeNull();
  });

  it("returns null when a required field is missing or the wrong type", async () => {
    await writeFile(join(dir, "BUILD_INFO.json"), JSON.stringify({ commit: 123 }), "utf8");
    expect(readWorkerBuildInfo(dir)).toBeNull();
  });

  it("never includes a secret-shaped field even if present in the raw marker (defense in depth)", async () => {
    await writeFile(
      join(dir, "BUILD_INFO.json"),
      JSON.stringify({ commit: "a".repeat(40), builtAt: "2026-08-26T00:00:00.000Z", token: "should-be-ignored" }),
      "utf8"
    );
    const result = readWorkerBuildInfo(dir);
    expect(result).toEqual({ commit: "a".repeat(40), builtAt: "2026-08-26T00:00:00.000Z" });
    expect(JSON.stringify(result)).not.toMatch(/token/i);
  });
});
