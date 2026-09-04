import { describe, expect, it, vi } from "vitest";
import type { JobDto } from "@dyo/schemas";
import { deriveWatchdogBudgetMs, executeJobWithWatchdog } from "./job-watchdog.js";
import type { JobDispatcherDeps, LatestHealth } from "./job-dispatcher.js";
import { JobExecutionRegistry } from "../runtime/job-execution-registry.js";
import { NotAvailableTemplateInspector } from "../inspection/template-inspector.js";
import { NotAvailableSceneEvidenceInspector } from "../inspection/scene-evidence-inspector.js";
import { NotAvailableAeEditBridge } from "../execution/ae-edit-bridge.js";
import { NotAvailablePreviewCapture } from "../execution/preview-capture.js";
import { NotAvailableAerenderRunner } from "../execution/render/aerender-runner.js";
import { NotAvailableCompositionVerifier } from "../execution/render/verify-render-composition.js";
import { NotAvailableRenderCapabilitiesInspector } from "../execution/render/inspect-render-capabilities.js";
import type { RenderArtifactUploader, UploadRenderArtifactResult } from "../execution/render/upload-render-artifact.js";
import type { PreviewUploader, UploadPreviewResult } from "../execution/upload-preview.js";
import type { FullPreviewUploader, UploadFullPreviewResult } from "../execution/preview/upload-full-preview.js";
import type {
  SceneEvidencePreviewUploader,
  UploadSceneEvidencePreviewResult
} from "../inspection/upload-scene-evidence-preview.js";
import type { AssetDownloadClient } from "../workspace/asset-cache.js";
import type { McpChildOwner, McpChildTerminationOutcome } from "../inspection/heroic-swan-mcp-client.js";
import type { SceneEvidenceInspector, SceneEvidenceResult } from "../inspection/scene-evidence-inspector.js";

class FakeArtifactUploader implements RenderArtifactUploader {
  async upload(): Promise<UploadRenderArtifactResult> {
    return { ok: true };
  }
}
class FakePreviewUploader implements PreviewUploader {
  async upload(): Promise<UploadPreviewResult> {
    return { ok: true };
  }
}
class FakeFullPreviewUploader implements FullPreviewUploader {
  async upload(): Promise<UploadFullPreviewResult> {
    return { ok: true };
  }
}
class FakeSceneEvidencePreviewUploader implements SceneEvidencePreviewUploader {
  async upload(): Promise<UploadSceneEvidencePreviewResult> {
    return { ok: true };
  }
}
class FakeAssetDownloadClient implements AssetDownloadClient {
  async download(): Promise<Buffer> {
    throw new Error("no asset download expected in these fixtures");
  }
}

const ONLINE_HEALTH: LatestHealth = { aeStatus: "ONLINE", mcpStatus: "ONLINE" };

function healthyDeps(overrides: Partial<JobDispatcherDeps> = {}): JobDispatcherDeps {
  return {
    templateInspector: new NotAvailableTemplateInspector(),
    sceneEvidenceInspector: new NotAvailableSceneEvidenceInspector(),
    getLatestHealth: () => ONLINE_HEALTH,
    runCheckHealthDiagnostics: () => Promise.reject(new Error("not used in these tests")),
    aeEditBridge: new NotAvailableAeEditBridge(),
    previewCapture: new NotAvailablePreviewCapture(),
    previewUploader: new FakePreviewUploader(),
    persistCheckpoint: async () => ({ ok: true }),
    assetDownloadClient: new FakeAssetDownloadClient(),
    aerenderPath: undefined,
    aerenderRunner: new NotAvailableAerenderRunner(),
    compositionVerifier: new NotAvailableCompositionVerifier(),
    artifactUploader: new FakeArtifactUploader(),
    renderCapabilitiesInspector: new NotAvailableRenderCapabilitiesInspector(),
    fullPreviewUploader: new FakeFullPreviewUploader(),
    sceneEvidencePreviewUploader: new FakeSceneEvidencePreviewUploader(),
    workRoot: "/tmp/does-not-matter-for-these-tests",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}

function sceneEvidenceJob(overrides: Partial<JobDto> = {}): JobDto {
  return {
    jobId: "c19a2fb9-c385-4254-97ee-2930ff25f917",
    workerId: "22222222-2222-2222-2222-222222222222",
    projectId: "20c6a75c-78b3-4686-be66-ab62e5a684e0",
    operation: "INSPECT_SCENE_EVIDENCE",
    status: "RUNNING",
    payload: {
      sourceProjectPath: "C:\\DYO-Agent\\copy\\White App Promo.aep",
      sourceProjectSha256: "a".repeat(64),
      manifestCompositionId: "comp-2147258508",
      aeProjectItemIndex: 69,
      compositionName: "Scene_03",
      layerIndices: [1, 2, 3],
      previewTimestampSeconds: null
    },
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

function hangingSceneEvidenceInspector(onInspectStarted: () => void): SceneEvidenceInspector {
  return {
    inspect: async (): Promise<SceneEvidenceResult> => {
      onInspectStarted();
      return await new Promise<SceneEvidenceResult>(() => {
        // Never resolves - simulates the real 2026-09-04 stuck job.
      });
    }
  };
}

function fakeOwner(outcome: McpChildTerminationOutcome): McpChildOwner & { terminate: ReturnType<typeof vi.fn> } {
  return { terminate: vi.fn(async () => outcome) };
}

describe("deriveWatchdogBudgetMs", () => {
  it("returns null for operations other than INSPECT_SCENE_EVIDENCE - no watchdog applied, unchanged behavior", () => {
    expect(deriveWatchdogBudgetMs({ operation: "INSPECT_TEMPLATE", payload: {} })).toBeNull();
    expect(deriveWatchdogBudgetMs({ operation: "RENDER", payload: {} })).toBeNull();
    expect(deriveWatchdogBudgetMs({ operation: "EXECUTE_FRAME", payload: {} })).toBeNull();
    expect(deriveWatchdogBudgetMs({ operation: "CHECK_HEALTH", payload: {} })).toBeNull();
  });

  it("derives (connect + (1 comp call + layerCount)) * per-call timeout * safety margin, with no preview capture", () => {
    const budget = deriveWatchdogBudgetMs({
      operation: "INSPECT_SCENE_EVIDENCE",
      payload: { layerIndices: [1, 2, 3], previewTimestampSeconds: null }
    });
    // (15000 connect + (1 + 3) * 15000) * 2 = (15000 + 60000) * 2 = 150000
    expect(budget).toBe(150_000);
  });

  it("adds one more call's worth of budget when a preview capture is requested", () => {
    const withoutPreview = deriveWatchdogBudgetMs({
      operation: "INSPECT_SCENE_EVIDENCE",
      payload: { layerIndices: [1, 2, 3], previewTimestampSeconds: null }
    });
    const withPreview = deriveWatchdogBudgetMs({
      operation: "INSPECT_SCENE_EVIDENCE",
      payload: { layerIndices: [1, 2, 3], previewTimestampSeconds: 2 }
    });
    expect(withPreview).toBe((withoutPreview ?? 0) + 30_000); // one extra call * 2x margin
  });

  it("matches the real 2026-09-04 incident's own shape (16 layers, no preview): a job stuck 20+ minutes vastly exceeds this budget", () => {
    const budget = deriveWatchdogBudgetMs({
      operation: "INSPECT_SCENE_EVIDENCE",
      payload: { layerIndices: Array.from({ length: 16 }, (_, i) => i + 1), previewTimestampSeconds: null }
    });
    // (15000 + 17 * 15000) * 2 = (15000 + 255000) * 2 = 540000 = 9 minutes
    expect(budget).toBe(540_000);
    expect(budget).toBeLessThan(20 * 60 * 1000); // the real incident's own 20+ minute runtime
  });

  it("treats a malformed/missing payload as zero layers (still counting the one ae_get_composition call) rather than throwing", () => {
    // (15000 connect + 1 comp call * 15000) * 2 = 60000
    expect(deriveWatchdogBudgetMs({ operation: "INSPECT_SCENE_EVIDENCE", payload: null })).toBe(60_000);
    expect(deriveWatchdogBudgetMs({ operation: "INSPECT_SCENE_EVIDENCE", payload: {} })).toBe(60_000);
  });
});

describe("executeJobWithWatchdog", () => {
  it("P5 test 9: a healthy job that completes within budget is returned unchanged, and the registry's active-job slot is freed", async () => {
    const registry = new JobExecutionRegistry();
    const result = { kind: "evidence" as const, response: {} as never };
    const deps = healthyDeps({ sceneEvidenceInspector: { inspect: async () => result } });

    const outcome = await executeJobWithWatchdog(deps, sceneEvidenceJob(), registry, undefined, 5_000);

    expect(outcome.status).toBe("SUCCEEDED");
    expect(registry.hasActiveJob()).toBe(false);
  });

  it("operations with no derived budget (e.g. INSPECT_TEMPLATE) pass through unaffected, even if slow, and free the slot", async () => {
    const registry = new JobExecutionRegistry();
    const deps = healthyDeps({
      templateInspector: {
        inspect: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { kind: "raw_capture", diagnostics: [], reason: "slow but not watchdog-bound" } as never;
        }
      }
    });
    const job = sceneEvidenceJob({ operation: "INSPECT_TEMPLATE", payload: { templateId: "t", sourceProjectPath: "x.aep" } });

    const outcome = await executeJobWithWatchdog(deps, job, registry, undefined, 999_999);

    expect(registry.hasActiveJob()).toBe(false);
    expect(outcome.status).toBe("FAILED"); // whatever job-dispatcher.ts itself reports - never a WATCHDOG_TIMEOUT, since no budget applies
    expect(outcome.error?.code).not.toBe("WATCHDOG_TIMEOUT");
  });

  it("P5 test 1: a job that hangs past its budget has its owned MCP child terminated, is reported FAILED/WATCHDOG_TIMEOUT, and frees the slot", async () => {
    const registry = new JobExecutionRegistry();
    const owner = fakeOwner({ outcome: "terminated", pid: 4321, reason: "x", durationMs: 3 });
    const deps = healthyDeps({
      sceneEvidenceInspector: hangingSceneEvidenceInspector(() => {
        registry.registerMcpOwner(owner);
      })
    });

    const outcome = await executeJobWithWatchdog(deps, sceneEvidenceJob(), registry, undefined, 20);

    expect(outcome.status).toBe("FAILED");
    expect(outcome.error?.code).toBe("WATCHDOG_TIMEOUT");
    expect(owner.terminate).toHaveBeenCalledTimes(1);
    expect(registry.hasActiveJob()).toBe(false); // slot freed - termination was confirmed
  });

  it("P5 test 7/8: if termination could NOT be confirmed, refuses to report a terminal status and leaves the registry's slot occupied (next job cannot claim/run until this is resolved)", async () => {
    const registry = new JobExecutionRegistry();
    const owner = fakeOwner({ outcome: "unconfirmed", pid: 4321, reason: "x", durationMs: 3 });
    const deps = healthyDeps({
      sceneEvidenceInspector: hangingSceneEvidenceInspector(() => {
        registry.registerMcpOwner(owner);
      })
    });

    await expect(executeJobWithWatchdog(deps, sceneEvidenceJob(), registry, undefined, 20)).rejects.toThrow(
      /could not be confirmed stopped/
    );
    expect(registry.hasActiveJob()).toBe(true); // deliberately NOT freed
  });

  it("logs a warning on timeout and on an unconfirmed termination, via an injected logger", async () => {
    const registry = new JobExecutionRegistry();
    const owner = fakeOwner({ outcome: "unconfirmed", pid: 1, reason: "x", durationMs: 1 });
    const deps = healthyDeps({
      sceneEvidenceInspector: hangingSceneEvidenceInspector(() => registry.registerMcpOwner(owner))
    });
    const warn = vi.fn();
    const info = vi.fn();

    await expect(executeJobWithWatchdog(deps, sceneEvidenceJob(), registry, { info, warn }, 20)).rejects.toThrow();

    expect(warn).toHaveBeenCalled();
  });
});
