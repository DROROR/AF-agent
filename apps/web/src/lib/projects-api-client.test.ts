import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject, fetchProjectList, updateExecutionPlan } from "./projects-api-client";

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
