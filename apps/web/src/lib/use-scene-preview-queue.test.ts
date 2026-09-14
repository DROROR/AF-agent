import { describe, expect, it } from "vitest";
import { isScenePreviewSettled, type ScenePreviewEntry } from "./use-scene-preview-queue";

const entry = (overrides: Partial<ScenePreviewEntry>): ScenePreviewEntry => ({
  preview: null,
  state: "idle",
  isStale: false,
  errorMessage: null,
  hasFailed: false,
  ...overrides
});

describe("isScenePreviewSettled (real 2026-09-14 Match Your Content lock)", () => {
  it("settles a current preview", () => {
    expect(isScenePreviewSettled(entry({ state: "ready" }))).toBe(true);
  });

  it("settles a generation attempt that definitively failed, with or without an older preview", () => {
    expect(isScenePreviewSettled(entry({ state: "unavailable", hasFailed: true, errorMessage: "failed" }))).toBe(true);
    expect(isScenePreviewSettled(entry({ state: "idle", hasFailed: true, errorMessage: "worker is busy" }))).toBe(true);
    expect(isScenePreviewSettled(entry({ state: "ready", isStale: true, hasFailed: true, errorMessage: "failed" }))).toBe(true);
  });

  it("never settles while a preview is still being checked, queued or generated - even after an earlier failure", () => {
    for (const state of ["checking", "queued", "generating"] as const) {
      expect(isScenePreviewSettled(entry({ state }))).toBe(false);
      expect(isScenePreviewSettled(entry({ state, hasFailed: true }))).toBe(false);
    }
  });

  it("never settles a stale preview that has not failed, or a scene simply waiting for a worker to come online", () => {
    expect(isScenePreviewSettled(entry({ state: "ready", isStale: true }))).toBe(false);
    expect(isScenePreviewSettled(entry({ state: "idle", errorMessage: "No computer is online to generate this preview right now." }))).toBe(false);
  });
});
