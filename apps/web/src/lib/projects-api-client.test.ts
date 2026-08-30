import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSET_UPLOAD_TIMEOUT_MS,
  GENERATE_SUGGESTIONS_TIMEOUT_MS,
  createExecutionPlan,
  createProject,
  fetchProjectList,
  generateMappingSuggestions,
  updateExecutionPlan,
  uploadAsset
} from "./projects-api-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(status: number, body: unknown): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }));
}

describe("fetchProjectList", () => {
  it("returns the real project list on a well-formed 200 response", async () => {
    stubFetch(200, { projects: [{ projectId: "11111111-1111-1111-1111-111111111111", name: "x", templateId: "t", sourceProjectSha256: "a".repeat(64), brandInputs: { logoAssetId: null, brandColors: [], textInstructions: null }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }] });
    const result = await fetchProjectList();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
    }
  });

  it("never renders a response that does not match the real contract as if it were valid data", async () => {
    stubFetch(200, { projects: [{ nonsense: true }] });
    const result = await fetchProjectList();
    expect(result.ok).toBe(false);
  });

  it("surfaces the real API error code/message on failure, never a fabricated one", async () => {
    stubFetch(500, { error: { code: "INTERNAL_ERROR", message: "boom", requestId: "r1" } });
    const result = await fetchProjectList();
    expect(result).toEqual({ ok: false, status: 500, code: "INTERNAL_ERROR", message: "boom" });
  });

  it("degrades honestly (never throws) when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await fetchProjectList();
    expect(result.ok).toBe(false);
  });
});

describe("updateExecutionPlan", () => {
  it("surfaces CONFLICT as a distinct, typed code for stale-revision handling", async () => {
    stubFetch(409, { error: { code: "CONFLICT", message: "stale revision", requestId: "r1" } });
    const result = await updateExecutionPlan("project-1", 1, [{ type: "INCLUDE_SCENE", scenePlanId: "scene-1" }]);
    expect(result).toEqual({ ok: false, status: 409, code: "CONFLICT", message: "stale revision" });
  });
});

describe("createExecutionPlan", () => {
  function validPlanResponse() {
    return {
      plan: {
        schemaVersion: "1.0",
        id: "plan-1",
        projectId: "project-1",
        revision: 1,
        status: "DRAFT",
        templateId: "tmpl-1",
        sourceProjectSha256: "a".repeat(64),
        approvedAt: null,
        approvedBy: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        scenePlans: [],
        renderOutputs: { LANDSCAPE: null, REELS: null }
      },
      sceneTable: []
    };
  }

  it("returns the real created (DRAFT) plan on a well-formed 201 response", async () => {
    stubFetch(201, validPlanResponse());
    const result = await createExecutionPlan("project-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.plan.status).toBe("DRAFT");
      expect(result.data.plan.approvedAt).toBeNull();
    }
  });

  it("never renders a malformed response as if it were a real created plan", async () => {
    stubFetch(201, { nonsense: true });
    const result = await createExecutionPlan("project-1");
    expect(result.ok).toBe(false);
  });

  it("surfaces CONFLICT (a plan already exists) as a distinct, typed code", async () => {
    stubFetch(409, { error: { code: "CONFLICT", message: "an execution plan already exists", requestId: "r1" } });
    const result = await createExecutionPlan("project-1");
    expect(result).toEqual({ ok: false, status: 409, code: "CONFLICT", message: "an execution plan already exists" });
  });

  it("degrades honestly (never throws) when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await createExecutionPlan("project-1");
    expect(result.ok).toBe(false);
  });
});

describe("uploadAsset - upload-specific timeout (proven fix for real MP4 upload failures)", () => {
  function validAssetResponse() {
    return {
      asset: {
        id: "asset-1",
        projectId: "11111111-1111-1111-1111-111111111111",
        originalFilename: "video.mp4",
        storageKey: "storage-key-1",
        mediaKind: "VIDEO",
        mimeType: "video/mp4",
        byteSize: 50_000_000,
        sha256: "a".repeat(64),
        width: null,
        height: null,
        durationSeconds: null,
        label: null,
        notes: null,
        uploadedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    };
  }
  function videoFile(): File {
    return new File(["x"], "video.mp4", { type: "video/mp4" });
  }

  it("ASSET_UPLOAD_TIMEOUT_MS is a bounded 10 minutes, never infinite", () => {
    expect(ASSET_UPLOAD_TIMEOUT_MS).toBe(10 * 60 * 1000);
  });

  it("uploadAsset arms its abort timer with the longer upload timeout, not the normal 8-second one", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    stubFetch(201, validAssetResponse());
    await uploadAsset("11111111-1111-1111-1111-111111111111", videoFile());
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(ASSET_UPLOAD_TIMEOUT_MS);
    expect(delays).not.toContain(8_000);
  });

  it("an ordinary JSON call (fetchProjectList) still arms its abort timer at the normal 8 seconds, never the upload timeout", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    stubFetch(200, { projects: [] });
    await fetchProjectList();
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(8_000);
    expect(delays).not.toContain(ASSET_UPLOAD_TIMEOUT_MS);
  });

  it("successful upload behavior is unchanged - a real 201 still returns the created asset", async () => {
    stubFetch(201, validAssetResponse());
    const result = await uploadAsset("11111111-1111-1111-1111-111111111111", videoFile());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.mediaKind).toBe("VIDEO");
    }
  });

  it("maps a real timeout (AbortError) to an actionable message, never the generic 'could not reach the server' one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const error = new Error("This operation was aborted");
        error.name = "AbortError";
        return Promise.reject(error);
      })
    );
    const result = await uploadAsset("11111111-1111-1111-1111-111111111111", videoFile());
    expect(result).toEqual({
      ok: false,
      status: 0,
      code: null,
      message: "Upload timed out before it completed. Please check your connection and try again."
    });
  });

  it("a real non-timeout network failure during upload still uses the existing generic message (never misattributed as a timeout)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await uploadAsset("11111111-1111-1111-1111-111111111111", videoFile());
    expect(result).toEqual({
      ok: false,
      status: 0,
      code: null,
      message: "Could not reach the server. Please try again."
    });
  });
});

describe("generateMappingSuggestions - long-running-generation-specific timeout (proven fix for real 8-second aborts on a 45-scene project)", () => {
  it("GENERATE_SUGGESTIONS_TIMEOUT_MS is a bounded 180 seconds, never infinite, and never reuses the 10-minute upload value", () => {
    expect(GENERATE_SUGGESTIONS_TIMEOUT_MS).toBe(180_000);
    expect(GENERATE_SUGGESTIONS_TIMEOUT_MS).not.toBe(ASSET_UPLOAD_TIMEOUT_MS);
  });

  it("arms its abort timer with the 180-second timeout, not the normal 8-second one", async () => {
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    stubFetch(200, { suggestions: [], aiAvailable: true, sceneEvidenceAvailability: {} });
    await generateMappingSuggestions("11111111-1111-1111-1111-111111111111");
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(GENERATE_SUGGESTIONS_TIMEOUT_MS);
    expect(delays).not.toContain(8_000);
  });

  it("successful generation behavior is unchanged - a real 200 still returns the suggestions list", async () => {
    stubFetch(200, { suggestions: [], aiAvailable: true, sceneEvidenceAvailability: {} });
    const result = await generateMappingSuggestions("11111111-1111-1111-1111-111111111111");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.aiAvailable).toBe(true);
    }
  });

  it("maps a real timeout (AbortError) to an actionable message, never the generic 'could not reach the server' one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const error = new Error("This operation was aborted");
        error.name = "AbortError";
        return Promise.reject(error);
      })
    );
    const result = await generateMappingSuggestions("11111111-1111-1111-1111-111111111111");
    expect(result).toEqual({
      ok: false,
      status: 0,
      code: null,
      message: "Mapping suggestions took too long to generate. Please try again."
    });
  });

  it("a real non-timeout network failure still uses the existing generic message (never misattributed as a timeout)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await generateMappingSuggestions("11111111-1111-1111-1111-111111111111");
    expect(result).toEqual({
      ok: false,
      status: 0,
      code: null,
      message: "Could not reach the server. Please try again."
    });
  });
});

describe("createProject", () => {
  it("returns the real created project on a well-formed 201 response - exists so a disposable project can be created for smoke-testing through the same authenticated path a real operator uses", async () => {
    stubFetch(201, {
      projectId: "11111111-1111-1111-1111-111111111111",
      name: "Diagnostic Disposable Project",
      templateId: "diag-tmpl",
      sourceProjectSha256: "b".repeat(64),
      brandInputs: { logoAssetId: null, brandColors: [], textInstructions: null },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    const result = await createProject({
      name: "Diagnostic Disposable Project",
      manifest: {
        schemaVersion: "1.0",
        templateId: "diag-tmpl",
        templateName: "diag-tmpl",
        sourceProject: { path: "/tmp/diag.aep", name: "diag.aep", sha256: "b".repeat(64) },
        afterEffects: { version: "26.3x87" },
        generatedAt: "2026-01-01T00:00:00.000Z",
        compositions: [],
        scenes: [],
        preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
        unknownItems: []
      }
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe("Diagnostic Disposable Project");
    }
  });

  it("never renders a malformed response as if it were a real created project", async () => {
    stubFetch(201, { nonsense: true });
    const result = await createProject({
      name: "x",
      manifest: {
        schemaVersion: "1.0",
        templateId: "t",
        templateName: "t",
        sourceProject: { path: "/tmp/x.aep", name: "x.aep", sha256: "c".repeat(64) },
        afterEffects: { version: "26.3x87" },
        generatedAt: "2026-01-01T00:00:00.000Z",
        compositions: [],
        scenes: [],
        preflight: { requiredFonts: [], footageReferenced: [], missingFootage: [], pluginReferences: [] },
        unknownItems: []
      }
    });
    expect(result.ok).toBe(false);
  });
});
