import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { CheckHealthResponse, JobDto } from "@dyo/schemas";
import { executeJob, type JobDispatcherDeps, type LatestHealth } from "./job-dispatcher.js";
import { NotAvailableTemplateInspector } from "../inspection/template-inspector.js";
import { NotAvailableSceneEvidenceInspector } from "../inspection/scene-evidence-inspector.js";

const currentDir = dirname(fileURLToPath(import.meta.url));

const ONLINE_HEALTH: LatestHealth = { aeStatus: "ONLINE", mcpStatus: "ONLINE" };

const FAKE_CHECK_HEALTH_RESPONSE: CheckHealthResponse = {
  aeStatus: "ONLINE",
  aeVersion: "26.3x87",
  mcpStatus: "OFFLINE",
  mcpProcess: {
    aeMcpPathConfigured: true,
    scriptExists: true,
    exitCode: 1,
    timedOut: false,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false
  },
  checkedAt: "2026-08-26T00:00:00.000Z"
};

/** Every existing test here is about payload/dispatch behavior, not the health gate itself - defaults to a healthy heartbeat so those tests reach the inspector as before. The gate has its own dedicated describe block below. */
function healthyDeps(overrides: Partial<JobDispatcherDeps> = {}): JobDispatcherDeps {
  return {
    templateInspector: new NotAvailableTemplateInspector(),
    sceneEvidenceInspector: new NotAvailableSceneEvidenceInspector(),
    getLatestHealth: () => ONLINE_HEALTH,
    runCheckHealthDiagnostics: () => Promise.resolve(FAKE_CHECK_HEALTH_RESPONSE),
    ...overrides
  };
}

function baseJob(overrides: Partial<JobDto> = {}): JobDto {
  return {
    jobId: "11111111-1111-1111-1111-111111111111",
    workerId: "22222222-2222-2222-2222-222222222222",
    projectId: null,
    operation: "INSPECT_TEMPLATE",
    status: "RUNNING",
    payload: { templateId: "tmpl-1", sourceProjectPath: "/copies/test.aep" },
    result: null,
    error: null,
    checkpoint: null,
    createdAt: new Date().toISOString(),
    claimedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("executeJob - INSPECT_TEMPLATE", () => {
  it("fails safely with NOT_AVAILABLE when the template inspector has no real transport yet - never fabricates a manifest", async () => {
    const result = await executeJob(healthyDeps(), baseJob());
    expect(result.status).toBe("FAILED");
    expect(result.error?.code).toBe("NOT_AVAILABLE");
  });

  it("fails with INVALID_PAYLOAD and never calls the inspector when the payload doesn't match the schema", async () => {
    const inspect = vi.fn();
    const result = await executeJob(
      healthyDeps({ templateInspector: { inspect } }),
      baseJob({ payload: { wrong: "shape" } })
    );
    expect(result.status).toBe("FAILED");
    expect(result.error?.code).toBe("INVALID_PAYLOAD");
    expect(inspect).not.toHaveBeenCalled();
  });

  it("succeeds and returns the inspector's response when a real inspector is wired in", async () => {
    const fakeResponse = { manifest: { schemaVersion: "1.0" }, summary: {} };
    const inspect = vi.fn().mockResolvedValue(fakeResponse);
    const result = await executeJob(healthyDeps({ templateInspector: { inspect } }), baseJob());
    expect(result.status).toBe("SUCCEEDED");
    expect(result.result).toBe(fakeResponse);
  });

  it("stamps workerId/jobId onto a raw_capture result before reporting it - the inspector itself is never handed job identity", async () => {
    const rawCapture = { kind: "raw_capture" as const, capturedAt: "2026-08-25T00:00:00.000Z", toolCalls: [], note: "test" };
    const inspect = vi.fn().mockResolvedValue(rawCapture);
    const job = baseJob({ workerId: "33333333-3333-3333-3333-333333333333", jobId: "44444444-4444-4444-4444-444444444444" });
    const result = await executeJob(healthyDeps({ templateInspector: { inspect } }), job);
    expect(result.status).toBe("SUCCEEDED");
    expect(result.result).toEqual({
      ...rawCapture,
      workerId: "33333333-3333-3333-3333-333333333333",
      jobId: "44444444-4444-4444-4444-444444444444"
    });
  });

  it("never stamps identity onto a manifest-kind result (only raw_capture results carry job/worker IDs)", async () => {
    const manifestResult = { kind: "manifest" as const, response: { manifest: {}, summary: {} } };
    const inspect = vi.fn().mockResolvedValue(manifestResult);
    const result = await executeJob(healthyDeps({ templateInspector: { inspect } }), baseJob());
    expect(result.result).toBe(manifestResult);
  });
});

describe("executeJob - INSPECT_TEMPLATE safety gate: AE and MCP must both be confirmed ONLINE", () => {
  it("fails with PRECONDITION_NOT_MET and never calls the inspector when no heartbeat has succeeded yet (getLatestHealth returns null)", async () => {
    const inspect = vi.fn();
    const result = await executeJob(
      healthyDeps({ templateInspector: { inspect }, getLatestHealth: () => null }),
      baseJob()
    );
    expect(result.status).toBe("FAILED");
    expect(result.error?.code).toBe("PRECONDITION_NOT_MET");
    expect(inspect).not.toHaveBeenCalled();
  });

  it("fails with PRECONDITION_NOT_MET and never calls the inspector when aeStatus is not ONLINE", async () => {
    const inspect = vi.fn();
    const result = await executeJob(
      healthyDeps({ templateInspector: { inspect }, getLatestHealth: () => ({ aeStatus: "OFFLINE", mcpStatus: "ONLINE" }) }),
      baseJob()
    );
    expect(result.status).toBe("FAILED");
    expect(result.error?.code).toBe("PRECONDITION_NOT_MET");
    expect(inspect).not.toHaveBeenCalled();
  });

  it("fails with PRECONDITION_NOT_MET and never calls the inspector when mcpStatus is not ONLINE", async () => {
    const inspect = vi.fn();
    const result = await executeJob(
      healthyDeps({ templateInspector: { inspect }, getLatestHealth: () => ({ aeStatus: "ONLINE", mcpStatus: "UNKNOWN" }) }),
      baseJob()
    );
    expect(result.status).toBe("FAILED");
    expect(result.error?.code).toBe("PRECONDITION_NOT_MET");
    expect(inspect).not.toHaveBeenCalled();
  });

  it("reaches the inspector when both aeStatus and mcpStatus are ONLINE", async () => {
    const inspect = vi.fn().mockResolvedValue({ kind: "raw_capture", capturedAt: "x", toolCalls: [], note: "n" });
    const result = await executeJob(
      healthyDeps({ templateInspector: { inspect }, getLatestHealth: () => ({ aeStatus: "ONLINE", mcpStatus: "ONLINE" }) }),
      baseJob()
    );
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("SUCCEEDED");
  });
});

describe("executeJob - CHECK_HEALTH", () => {
  function checkHealthJob(overrides: Partial<JobDto> = {}): JobDto {
    return baseJob({ operation: "CHECK_HEALTH", payload: {}, ...overrides });
  }

  it("succeeds and returns the diagnostics response for a well-formed payload", async () => {
    const runCheckHealthDiagnostics = vi.fn().mockResolvedValue(FAKE_CHECK_HEALTH_RESPONSE);
    const result = await executeJob(healthyDeps({ runCheckHealthDiagnostics }), checkHealthJob());
    expect(result.status).toBe("SUCCEEDED");
    expect(result.result).toBe(FAKE_CHECK_HEALTH_RESPONSE);
    expect(runCheckHealthDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("rejects an unexpected payload field - never a generic command/argument passthrough", async () => {
    const runCheckHealthDiagnostics = vi.fn();
    const result = await executeJob(
      healthyDeps({ runCheckHealthDiagnostics }),
      checkHealthJob({ payload: { cmd: "rm -rf /" } })
    );
    expect(result.status).toBe("FAILED");
    expect(result.error?.code).toBe("INVALID_PAYLOAD");
    expect(runCheckHealthDiagnostics).not.toHaveBeenCalled();
  });

  it("still runs CHECK_HEALTH when mcpStatus is OFFLINE and even when no heartbeat has succeeded yet - diagnosing that is its whole purpose", async () => {
    const runCheckHealthDiagnostics = vi.fn().mockResolvedValue(FAKE_CHECK_HEALTH_RESPONSE);
    const result = await executeJob(
      healthyDeps({ getLatestHealth: () => null, runCheckHealthDiagnostics }),
      checkHealthJob()
    );
    expect(result.status).toBe("SUCCEEDED");
    expect(runCheckHealthDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("reports INTERNAL_ERROR (never crashes) if the diagnostics function itself throws", async () => {
    const runCheckHealthDiagnostics = vi.fn().mockRejectedValue(new Error("spawn failed unexpectedly"));
    const result = await executeJob(healthyDeps({ runCheckHealthDiagnostics }), checkHealthJob());
    expect(result.status).toBe("FAILED");
    expect(result.error?.code).toBe("INTERNAL_ERROR");
  });
});

describe("executeJob - INSPECT_SCENE_EVIDENCE", () => {
  function sceneEvidenceJob(overrides: Partial<JobDto> = {}): JobDto {
    return baseJob({
      operation: "INSPECT_SCENE_EVIDENCE",
      payload: {
        sourceProjectPath: "/copies/test.aep",
        sourceProjectSha256: "a".repeat(64),
        manifestCompositionId: "comp-275",
        compositionIndex: 14,
        layerIndices: [1]
      },
      ...overrides
    });
  }

  it("fails safely with NOT_AVAILABLE when the inspector has no real transport yet - never fabricates evidence", async () => {
    const result = await executeJob(healthyDeps(), sceneEvidenceJob());
    expect(result.status).toBe("FAILED");
    expect(result.error?.code).toBe("NOT_AVAILABLE");
  });

  it("rejects an unexpected payload field - never a generic passthrough, e.g. no arbitrary layer property path", async () => {
    const inspect = vi.fn();
    const result = await executeJob(
      healthyDeps({ sceneEvidenceInspector: { inspect } }),
      sceneEvidenceJob({ payload: { sourceProjectPath: "/copies/test.aep", propertyPath: "ADBE Text Properties" } })
    );
    expect(result.status).toBe("FAILED");
    expect(result.error?.code).toBe("INVALID_PAYLOAD");
    expect(inspect).not.toHaveBeenCalled();
  });

  it("returns the evidence result on success", async () => {
    const evidenceResult = {
      kind: "evidence" as const,
      response: {
        verifiedSourceProjectSha256: "a".repeat(64),
        manifestCompositionId: "comp-275",
        compositionIndex: 14,
        compositionName: "Text 01",
        layers: [],
        preview: null,
        previewFailureReason: null,
        capturedAt: "2026-08-26T00:00:00.000Z"
      }
    };
    const inspect = vi.fn().mockResolvedValue(evidenceResult);
    const result = await executeJob(healthyDeps({ sceneEvidenceInspector: { inspect } }), sceneEvidenceJob());
    expect(result.status).toBe("SUCCEEDED");
    expect(result.result).toBe(evidenceResult.response);
  });

  it("reports a typed failure (not a crash) when the inspector reports kind: failure", async () => {
    const inspect = vi.fn().mockResolvedValue({ kind: "failure", reason: "source project changed" });
    const result = await executeJob(healthyDeps({ sceneEvidenceInspector: { inspect } }), sceneEvidenceJob());
    expect(result.status).toBe("FAILED");
    expect(result.error?.code).toBe("NOT_AVAILABLE");
    expect(result.error?.message).toBe("source project changed");
  });

  it("fails with PRECONDITION_NOT_MET and never calls the inspector when AE/MCP are not both ONLINE - same gate as INSPECT_TEMPLATE", async () => {
    const inspect = vi.fn();
    const result = await executeJob(
      healthyDeps({ sceneEvidenceInspector: { inspect }, getLatestHealth: () => null }),
      sceneEvidenceJob()
    );
    expect(result.status).toBe("FAILED");
    expect(result.error?.code).toBe("PRECONDITION_NOT_MET");
    expect(inspect).not.toHaveBeenCalled();
  });
});

describe("executeJob - unsupported operations", () => {
  it("fails safely with UNSUPPORTED_OPERATION for a recognized-but-unimplemented operation", async () => {
    const result = await executeJob(healthyDeps(), baseJob({ operation: "RENDER" }));
    expect(result.status).toBe("FAILED");
    expect(result.error?.code).toBe("UNSUPPORTED_OPERATION");
  });

  it("fails safely for an operation string outside WORKER_CAPABILITIES entirely, rather than attempting it", async () => {
    const result = await executeJob(healthyDeps(), baseJob({ operation: "rm -rf /" as never }));
    expect(result.status).toBe("FAILED");
    expect(result.error?.code).toBe("UNSUPPORTED_OPERATION");
  });
});

describe("job-dispatcher.ts (no arbitrary shell/JSX execution path)", () => {
  it("contains no arbitrary code/command-execution primitive", () => {
    const contents = readFileSync(join(currentDir, "job-dispatcher.ts"), "utf8");
    for (const pattern of [/\beval\s*\(/, /\bnew Function\s*\(/, /child_process/, /\bexec(File)?\s*\(/]) {
      expect(contents, `job-dispatcher.ts matched forbidden pattern ${pattern}`).not.toMatch(pattern);
    }
  });

  it("dispatches only via a fixed switch on job.operation - no dynamic property/method lookup by a caller-supplied string", () => {
    const contents = readFileSync(join(currentDir, "job-dispatcher.ts"), "utf8");
    // Guards against a future refactor introducing e.g. handlers[job.operation]() -
    // dynamic dispatch by an operation name string, even one that's schema-validated,
    // is a materially different (and unnecessary) risk shape than a fixed switch.
    expect(contents).not.toMatch(/\[\s*job\.operation\s*\]/);
  });

  it("never references ae_run_jsx, and only ever mentions RawInspectionCapture's own defined field names", () => {
    const contents = readFileSync(join(currentDir, "job-dispatcher.ts"), "utf8");
    expect(contents).not.toMatch(/ae_run_jsx/);
  });
});
