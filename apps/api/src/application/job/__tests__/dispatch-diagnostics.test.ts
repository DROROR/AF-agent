import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PreconditionNotMetError } from "../../../errors/app-error.js";
import { InMemoryWorkerRepository } from "../../worker/test-support/in-memory-worker-repository.js";
import { InMemoryJobRepository } from "../test-support/in-memory-job-repository.js";
import { InMemoryProjectRepository } from "../../project/test-support/in-memory-project-repository.js";
import { InMemoryExecutionPlanRepository } from "../../execution-plan/test-support/in-memory-execution-plan-repository.js";
import { InMemoryExecutionSessionRepository } from "../../execution-session/test-support/in-memory-execution-session-repository.js";
import { InMemoryFullPreviewArtifactRepository } from "../../execution-session/test-support/in-memory-full-preview-artifact-repository.js";
import { InMemoryAssetRepository } from "../../asset/test-support/in-memory-asset-repository.js";
import { dispatchJob } from "../dispatch-job.js";
import { DIAGNOSTIC_RATE_LIMITS } from "../diagnostic-rate-limit.js";

const FIXED_NOW = new Date("2026-09-12T14:30:00.000Z");
const STALE_AFTER_MS = 30_000;

function deps(jobRepository: InMemoryJobRepository, workerRepository: InMemoryWorkerRepository, now = FIXED_NOW) {
  return {
    jobRepository,
    workerRepository,
    projectRepository: new InMemoryProjectRepository(),
    executionPlanRepository: new InMemoryExecutionPlanRepository(),
    executionSessionRepository: new InMemoryExecutionSessionRepository(),
    assetRepository: new InMemoryAssetRepository(),
    fullPreviewArtifactRepository: new InMemoryFullPreviewArtifactRepository(),
    now: () => now,
    staleAfterMs: STALE_AFTER_MS
  };
}

async function setupWorker(
  workerRepository: InMemoryWorkerRepository,
  capabilities: string[] = ["RUN_DIAGNOSTIC", "RESTART_WORKER_SAFE"],
  health: { aeStatus: "ONLINE" | "OFFLINE"; mcpStatus: "ONLINE" | "UNKNOWN" } = { aeStatus: "ONLINE", mcpStatus: "ONLINE" }
) {
  const workerId = randomUUID();
  await workerRepository.create(
    { id: workerId, name: "FAHADNAKASH", tokenHash: "hash", maxConcurrency: 1, capabilities: capabilities as never },
    FIXED_NOW
  );
  await workerRepository.updateHeartbeat(
    workerId,
    { aeStatus: health.aeStatus, mcpStatus: health.mcpStatus, aeVersion: "26.3x87", currentJobId: null },
    FIXED_NOW
  );
  return workerId;
}

const diagnosticRequest = (workerId: string) =>
  ({ operation: "RUN_DIAGNOSTIC", workerId, payload: { kind: "GET_WORKER_LOG_TAIL" } }) as const;

describe("dispatching a remote diagnostic", () => {
  it("queues a read-only diagnostic on a healthy worker", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupWorker(workerRepository);

    const dto = await dispatchJob(deps(jobRepository, workerRepository), diagnosticRequest(workerId), randomUUID());

    expect(dto.operation).toBe("RUN_DIAGNOSTIC");
    expect(dto.status).toBe("QUEUED");
  });

  // A diagnostic must work precisely when AE/MCP are unhealthy - that is
  // when it is needed. Gating it on AE would make it useless.
  it("is NOT gated on AE/MCP health, unlike the AE-dependent operations", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupWorker(workerRepository, ["RUN_DIAGNOSTIC"], { aeStatus: "OFFLINE", mcpStatus: "UNKNOWN" });

    const dto = await dispatchJob(deps(jobRepository, workerRepository), diagnosticRequest(workerId), randomUUID());
    expect(dto.status).toBe("QUEUED");
  });

  it("refuses a worker whose build does not advertise the capability", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupWorker(workerRepository, ["INSPECT_TEMPLATE"]);

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), diagnosticRequest(workerId), randomUUID())
    ).rejects.toThrow(/does not report the RUN_DIAGNOSTIC capability/);
  });

  it("enforces the read-only diagnostic rate limit within its window", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupWorker(workerRepository);
    const userId = randomUUID();
    const limit = DIAGNOSTIC_RATE_LIMITS.RUN_DIAGNOSTIC;

    for (let index = 0; index < limit.maxInWindow; index += 1) {
      const dto = await dispatchJob(deps(jobRepository, workerRepository), diagnosticRequest(workerId), userId);
      // Terminate each one so the duplicate/concurrency gates do not fire first.
      await jobRepository.updateStatus(dto.jobId, workerId, { status: "CANCELLED", expectedCurrentStatus: "QUEUED" }, FIXED_NOW);
    }

    await expect(
      dispatchJob(deps(jobRepository, workerRepository), diagnosticRequest(workerId), userId)
    ).rejects.toBeInstanceOf(PreconditionNotMetError);
  });

  it("lets the rate limit RECOVER once the window has passed", async () => {
    const workerRepository = new InMemoryWorkerRepository();
    const jobRepository = new InMemoryJobRepository(workerRepository);
    const workerId = await setupWorker(workerRepository);
    const userId = randomUUID();
    const limit = DIAGNOSTIC_RATE_LIMITS.RUN_DIAGNOSTIC;

    for (let index = 0; index < limit.maxInWindow; index += 1) {
      const dto = await dispatchJob(deps(jobRepository, workerRepository), diagnosticRequest(workerId), userId);
      await jobRepository.updateStatus(dto.jobId, workerId, { status: "CANCELLED", expectedCurrentStatus: "QUEUED" }, FIXED_NOW);
    }

    const later = new Date(FIXED_NOW.getTime() + limit.windowMs + 1_000);
    await workerRepository.updateHeartbeat(
      workerId,
      { aeStatus: "ONLINE", mcpStatus: "ONLINE", aeVersion: "26.3x87", currentJobId: null },
      later
    );
    const dto = await dispatchJob(deps(jobRepository, workerRepository, later), diagnosticRequest(workerId), userId);
    expect(dto.status).toBe("QUEUED");
  });

  it("rate-limits RESTART far more tightly than read-only evidence gathering", () => {
    expect(DIAGNOSTIC_RATE_LIMITS.RESTART_WORKER_SAFE.maxInWindow).toBeLessThan(
      DIAGNOSTIC_RATE_LIMITS.RUN_DIAGNOSTIC.maxInWindow
    );
    expect(DIAGNOSTIC_RATE_LIMITS.RESTART_WORKER_SAFE.windowMs).toBeGreaterThan(
      DIAGNOSTIC_RATE_LIMITS.RUN_DIAGNOSTIC.windowMs
    );
  });
});
