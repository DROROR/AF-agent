import { existsSync } from "node:fs";
import pino from "pino";
import { resolveWorkerCredentials } from "./bootstrap.js";
import { CURRENT_WORKER_CAPABILITIES } from "./domain/operation-allowlist.js";
import type { LatestHealth } from "./domain/job-dispatcher.js";
import { executeJobWithWatchdog } from "./domain/job-watchdog.js";
import { loadWorkerEnv } from "./env.js";
import { ConfigError } from "./errors/worker-error.js";
import { buildHealthSnapshot } from "./health/health-snapshot.js";
import { HeroicSwanMcpAdapter } from "./health/heroic-swan-mcp-adapter.js";
import { runCheckHealthDiagnostics } from "./health/run-check-health-diagnostics.js";
import { readWorkerBuildInfo } from "./version.js";
import { HeroicSwanTemplateInspector } from "./inspection/heroic-swan-template-inspector.js";
import { HeroicSwanSceneEvidenceInspector } from "./inspection/heroic-swan-scene-evidence-inspector.js";
import { HeroicSwanAeEditBridge, NotAvailableAeEditBridge } from "./execution/ae-edit-bridge.js";
import { HeroicSwanPreviewCapture, NotAvailablePreviewCapture } from "./execution/preview-capture.js";
import { HeroicSwanPreviewUploader } from "./execution/upload-preview.js";
import { RealAerenderRunner, NotAvailableAerenderRunner } from "./execution/render/aerender-runner.js";
import { HeroicSwanCompositionVerifier, NotAvailableCompositionVerifier } from "./execution/render/verify-render-composition.js";
import { HeroicSwanRenderCapabilitiesInspector, NotAvailableRenderCapabilitiesInspector } from "./execution/render/inspect-render-capabilities.js";
import { HeroicSwanRenderArtifactUploader } from "./execution/render/upload-render-artifact.js";
import { HeroicSwanFullPreviewUploader } from "./execution/preview/upload-full-preview.js";
import { HeroicSwanSceneEvidencePreviewUploader } from "./inspection/upload-scene-evidence-preview.js";
import { HeroicSwanAssetDownloadClient } from "./execution/resolve-scene-edit-operation.js";
import { ApiClient } from "./infrastructure/api-client.js";
import { CredentialStore } from "./infrastructure/credential-store.js";
import { createProcessLister } from "./infrastructure/process-lister.js";
import { HeartbeatLoop, type HeartbeatLoopEvent } from "./runtime/heartbeat-loop.js";
import { runJobCycle, type JobCycleEvent } from "./runtime/job-cycle.js";
import { shutdownGracefully } from "./runtime/shutdown.js";
import { JobExecutionRegistry } from "./runtime/job-execution-registry.js";
import { reconcileAbandonedJobs } from "./runtime/reconcile-abandoned-jobs.js";
import { installProcessSafetyNet } from "./runtime/process-safety-net.js";
import { installSignalHandlers } from "./runtime/signal-handlers.js";
import { buildHeartbeatPayload } from "./application/build-heartbeat-payload.js";
import { ensureWorkRoot, resolveWorkRoot } from "./workspace/work-root.js";

/** Not exposed via env - Phase 2 fixes a conservative, bounded retry policy rather than making it operator-tunable before there's a reason to. */
const HEARTBEAT_BACKOFF_POLICY = { baseMs: 2_000, maxMs: 60_000 };

function logJobCycleEvent(logger: pino.Logger, event: JobCycleEvent): void {
  switch (event.type) {
    case "no_job_available":
      return;
    case "job_claimed":
      logger.info({ jobId: event.jobId, operation: event.operation }, "job claimed");
      return;
    case "job_completed":
      logger.info({ jobId: event.jobId, status: event.status }, "job completed");
      return;
    case "job_cycle_failed":
      logger.warn(
        { error: event.error instanceof Error ? event.error.message : String(event.error) },
        "job cycle failed, will retry on next heartbeat"
      );
      return;
    default: {
      const _exhaustive: never = event;
      throw new Error(`Unhandled job cycle event: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function logHeartbeatEvent(logger: pino.Logger, event: HeartbeatLoopEvent): void {
  switch (event.type) {
    case "heartbeat_succeeded":
      logger.info(
        {
          status: event.worker.status,
          aeStatus: event.worker.aeStatus,
          mcpStatus: event.worker.mcpStatus,
          maxConcurrency: event.worker.maxConcurrency
        },
        "heartbeat succeeded"
      );
      return;
    case "heartbeat_failed":
      if (event.authRejected) {
        // Distinct from the generic "will retry" below: a 401 means the
        // server reachably rejected our credentials, which no amount of
        // retrying fixes on its own (unlike a network blip or a temporary
        // 5xx) - an operator needs to look at this, so it's logged at
        // error level with a message a log scanner/alert can key on,
        // rather than blending into ordinary transient-failure noise.
        // Still retried automatically (never re-registers, never exits) -
        // see heartbeat-loop.ts's own doc comment on this event field.
        logger.error(
          { consecutiveFailures: event.consecutiveFailures, nextRetryMs: event.nextRetryMs },
          "NEEDS_ATTENTION: DYO API rejected this worker's credentials (401) - will keep retrying automatically, but this will not resolve without an administrator re-pairing this worker"
        );
        return;
      }
      logger.warn(
        {
          consecutiveFailures: event.consecutiveFailures,
          nextRetryMs: event.nextRetryMs,
          error: event.error instanceof Error ? event.error.message : String(event.error)
        },
        "heartbeat failed, will retry"
      );
      return;
    case "loop_stopped":
      logger.info("heartbeat loop stopped");
      return;
    default: {
      // Exhaustiveness guard: if HeartbeatLoopEvent gains a variant, this
      // fails to compile until it's handled above, rather than silently
      // logging nothing for it.
      const _exhaustive: never = event;
      throw new Error(`Unhandled heartbeat loop event: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

async function main(): Promise<void> {
  const logger = pino({ level: "info" });
  installProcessSafetyNet({ logger, exit: process.exit.bind(process), process });

  const env = loadWorkerEnv();
  const workRoot = resolveWorkRoot(env.workRoot);
  ensureWorkRoot(workRoot);

  const apiClient = new ApiClient({ apiUrl: env.apiUrl });
  const credentialStore = new CredentialStore(workRoot);
  const credentials = await resolveWorkerCredentials(env, credentialStore, apiClient, logger);

  const workerLogger = logger.child({ workerId: credentials.workerId, workerName: env.workerName });
  // Harmless build/version marker (commit + build timestamp, never a
  // secret) - null in local dev where no packaged BUILD_INFO.json exists.
  // Logged once at startup so worker.log can prove exactly which build is
  // actually running, e.g. after a Windows Worker update.
  const buildInfo = readWorkerBuildInfo();
  workerLogger.info(
    { workRoot, capabilities: CURRENT_WORKER_CAPABILITIES, buildInfo },
    "worker starting"
  );

  // Single source of truth for "what job is this Worker currently
  // executing, and which owned ae-mcp child process(es) belong to it" -
  // see runtime/job-execution-registry.ts's own doc comment (2026-09-04
  // stuck-job P0/P1/P2 fix). Threaded into every inspector that owns an
  // MCP connection AND into the watchdog/shutdown paths below, so a hung
  // job's own owned process can always be found and terminated.
  const jobExecutionRegistry = new JobExecutionRegistry(workerLogger);

  const processLister = createProcessLister();
  // Primary MCP health source: the real HeroicSwan/after-effects-mcp CLI's
  // documented `health` subcommand and exit-code contract (confirmed
  // 2026-08-24 directly from the upstream repository) - not undocumented
  // instance.json file internals. Always safe to construct even with no
  // AE_MCP_PATH configured (or on a Linux dev/test machine): it reports
  // UNKNOWN rather than crashing or fabricating a status.
  const mcpAdapter = new HeroicSwanMcpAdapter({ aeMcpPath: env.aeMcpPath });

  // Real, production INSPECT_TEMPLATE implementation - see
  // docs/TEMPLATE-INSPECTOR.md. Always safe to construct even with no
  // AE_MCP_PATH configured: inspect() reports a typed unavailable capture
  // rather than crashing or fabricating a result.
  const templateInspector = new HeroicSwanTemplateInspector({
    aeMcpPath: env.aeMcpPath,
    logger: workerLogger,
    jobExecutionRegistry
  });

  // Real, production INSPECT_SCENE_EVIDENCE implementation (Phase 7B) -
  // same "safe to construct with no AE_MCP_PATH" contract as above.
  const sceneEvidenceInspector = new HeroicSwanSceneEvidenceInspector({
    aeMcpPath: env.aeMcpPath,
    logger: workerLogger,
    jobExecutionRegistry
  });

  // Real EXECUTE_FRAME mutation/preview implementations - same "safe to
  // construct with no AE_MCP_PATH" contract as the two inspectors above.
  // CODE_COMPLETE, not REAL_WINDOWS_AE_PROVEN (see execution/jsx-templates.ts's
  // own doc comment on the unverified ae_run_jsx tool assumption) -
  // EXECUTE_FRAME is deliberately NOT yet added to
  // CURRENT_WORKER_CAPABILITIES (operation-allowlist.ts), so this worker
  // build does not yet self-report the capability at registration/
  // heartbeat time, even though job-dispatcher.ts can now execute one if
  // ever dispatched directly (e.g. in a test/staging harness).
  const aeEditBridge = env.aeMcpPath
    ? new HeroicSwanAeEditBridge({ aeMcpPath: env.aeMcpPath })
    : new NotAvailableAeEditBridge();
  const previewCapture = env.aeMcpPath
    ? new HeroicSwanPreviewCapture(env.aeMcpPath)
    : new NotAvailablePreviewCapture();

  // Real RENDER (aerender) implementations - CODE_COMPLETE, not
  // REAL_WINDOWS_AERENDER_PROVEN (see execution/render/render-project-executor.ts's
  // own doc comment). aerenderRunner is only ever constructed as real when
  // AERENDER_PATH is configured AND actually points at a real file on this
  // worker's own disk right now (mirrors ae-health.ts's own
  // "aerenderAvailable" check) - never assumed just because the env var is
  // set. RENDER is deliberately NOT yet added to CURRENT_WORKER_CAPABILITIES,
  // same "not yet self-reported at heartbeat time" convention as EXECUTE_FRAME.
  const aerenderRunner =
    env.aerenderPath && existsSync(env.aerenderPath) ? new RealAerenderRunner() : new NotAvailableAerenderRunner();
  const compositionVerifier = env.aeMcpPath
    ? new HeroicSwanCompositionVerifier(env.aeMcpPath)
    : new NotAvailableCompositionVerifier();
  const renderCapabilitiesInspector = env.aeMcpPath
    ? new HeroicSwanRenderCapabilitiesInspector({ aeMcpPath: env.aeMcpPath })
    : new NotAvailableRenderCapabilitiesInspector();
  // Always real - unlike the AE-dependent implementations above, uploading
  // already-rendered bytes to the API needs only this worker's own
  // credentials (already resolved above), never ae-mcp/aerender.
  const artifactUploader = new HeroicSwanRenderArtifactUploader(apiClient, credentials.workerId, credentials.workerToken);
  // Same reasoning - uploading an already-captured preview PNG only needs
  // this worker's own credentials, never ae-mcp/aerender.
  const previewUploader = new HeroicSwanPreviewUploader(apiClient, credentials.workerId, credentials.workerToken);
  // Same reasoning - uploading an already-created complete-preview video
  // (CREATE_PREVIEW) only needs this worker's own credentials, never
  // ae-mcp/aerender.
  const fullPreviewUploader = new HeroicSwanFullPreviewUploader(apiClient, credentials.workerId, credentials.workerToken);
  // Same reasoning - uploading an already-captured scene-evidence preview
  // frame only needs this worker's own credentials, never ae-mcp/aerender.
  const sceneEvidencePreviewUploader = new HeroicSwanSceneEvidencePreviewUploader(apiClient, credentials.workerId, credentials.workerToken);
  // Same reasoning - MAP_FOOTAGE's asset delivery only needs this worker's
  // own credentials, never ae-mcp/aerender.
  const assetDownloadClient = new HeroicSwanAssetDownloadClient(apiClient, credentials.workerId, credentials.workerToken);

  // The last CONFIRMED (server round-tripped) aeStatus/mcpStatus, updated
  // only on a successful heartbeat - the safety gate INSPECT_TEMPLATE
  // checks before ever touching ae-mcp (see job-dispatcher.ts). null until
  // the very first heartbeat succeeds, which is also the earliest point a
  // job could ever be attempted (see onEvent below).
  let latestHealth: LatestHealth | null = null;

  // P1 fix (2026-09-04): the in-flight job-cycle promise, tracked (never
  // fire-and-forget `void`) so (a) triggerJobCycle can refuse to start a
  // SECOND overlapping cycle if a previous one has not yet settled - real
  // gap: heartbeat ticks reschedule themselves right after sendHeartbeat
  // resolves, independent of whether a previously-triggered job cycle is
  // still running, so nothing previously stopped two cycles from running
  // concurrently on a job that outlives one heartbeat interval - and (b)
  // shutdownGracefully can actually wait for it to settle after an abort,
  // instead of exiting mid-job. maxConcurrency=1 is preserved either way
  // by dispatch-job.ts's own server-side activeCount gate, but this closes
  // the same gap at the Worker's own level, defense in depth.
  let activeJobCyclePromise: Promise<void> | null = null;

  // One bounded claim/execute/report attempt per successful heartbeat -
  // never a separate tight polling loop, so job attempts are naturally
  // paced by HEARTBEAT_INTERVAL_MS with no blind retries.
  const triggerJobCycle = (): void => {
    if (activeJobCyclePromise) {
      workerLogger.info({}, "job cycle already in progress - skipping this heartbeat's trigger");
      return;
    }
    // If a watchdog previously aborted a job but could NOT confirm its
    // owned ae-mcp process actually stopped, job-watchdog.ts deliberately
    // leaves the registry's active-job slot set (never endJob()'d) even
    // though the job cycle promise above has already settled - this
    // process must refuse to execute anything else until restarted with
    // confirmed cleanup (see deploy/windows-worker/DYO-Worker-Recover.ps1).
    if (jobExecutionRegistry.hasActiveJob()) {
      workerLogger.warn(
        {},
        "refusing to start a new job cycle - a previous job's owned MCP process could not be confirmed stopped; this worker needs to be restarted via the recovery script"
      );
      return;
    }
    const cyclePromise = runJobCycle({
      claimNextJob: () => apiClient.claimNextJob(credentials.workerId, credentials.workerToken),
      reportJobStatus: (jobId, body) =>
        apiClient.reportJobStatus(credentials.workerId, credentials.workerToken, jobId, body),
      executeJob: (job) =>
        executeJobWithWatchdog(
          {
            templateInspector,
            sceneEvidenceInspector,
            getLatestHealth: () => latestHealth,
            runCheckHealthDiagnostics: () =>
              runCheckHealthDiagnostics(
                { aePath: env.aePath, aerenderPath: env.aerenderPath, aeMcpPath: env.aeMcpPath },
                { processLister }
              ),
            aeEditBridge,
            previewCapture,
            previewUploader,
            assetDownloadClient,
            aerenderPath: env.aerenderPath,
            aerenderRunner,
            compositionVerifier,
            artifactUploader,
            renderCapabilitiesInspector,
            fullPreviewUploader,
            sceneEvidencePreviewUploader,
            // Durable mid-job checkpoint reporter for THIS job - closes
            // over job.jobId (job is already known at this call site) and
            // never marks the job's own status, only the separate
            // checkpoint endpoint (see report-job-checkpoint.ts). Any
            // failure - network, or the API rejecting it as stale/no
            // longer RUNNING - is translated into { ok: false }, never
            // thrown, so the executor's own "stop rather than guess"
            // handling (execute-scene-edit-executor.ts) always runs.
            persistCheckpoint: async (checkpoint) => {
              try {
                await apiClient.reportCheckpoint(credentials.workerId, credentials.workerToken, job.jobId, checkpoint);
                return { ok: true };
              } catch (cause) {
                return {
                  ok: false,
                  reason: cause instanceof Error ? cause.message : "checkpoint report failed"
                };
              }
            },
            workRoot,
            now: () => new Date()
          },
          job,
          jobExecutionRegistry,
          workerLogger
        ),
      onEvent: (event) => logJobCycleEvent(workerLogger, event)
    }).finally(() => {
      activeJobCyclePromise = null;
    });
    activeJobCyclePromise = cyclePromise;
  };

  const loop = new HeartbeatLoop({
    buildPayload: async () => {
      const health = await buildHealthSnapshot(
        { aePath: env.aePath, aerenderPath: env.aerenderPath },
        { processLister, mcpAdapter }
      );
      // Local-only diagnostic (never part of the heartbeat wire payload -
      // buildHeartbeatPayload's own explicit field whitelist never reads
      // mcpProbeDetail) so a real "why" (a specific exit code, a timeout,
      // a spawn failure) is captured in worker.log itself rather than only
      // ever surviving as the coarser ONLINE/OFFLINE/UNKNOWN enum the
      // server sees. Logged only when not ONLINE, to avoid noise on every
      // routine successful heartbeat.
      if (health.mcpStatus !== "ONLINE") {
        workerLogger.warn(
          { mcpStatus: health.mcpStatus, mcpProbeDetail: health.mcpProbeDetail, mcpConfiguredPath: health.mcpConfiguredPath },
          "mcp health probe did not report ONLINE"
        );
      }
      return buildHeartbeatPayload(health);
    },
    sendHeartbeat: (payload) =>
      apiClient.sendHeartbeat(credentials.workerId, credentials.workerToken, payload),
    intervalMs: env.heartbeatIntervalMs,
    backoff: HEARTBEAT_BACKOFF_POLICY,
    onEvent: (event) => {
      logHeartbeatEvent(workerLogger, event);
      if (event.type === "heartbeat_succeeded") {
        // Recorded from the SERVER's own echoed-back WorkerDto (confirmed
        // persisted), not the locally-computed snapshot - the gate should
        // reflect what the API actually has on record, the same source of
        // truth server-side verification (docs/AUDIT.md) already uses.
        latestHealth = { aeStatus: event.worker.aeStatus, mcpStatus: event.worker.mcpStatus };
        triggerJobCycle();
      }
    }
  });

  installSignalHandlers({
    logger: workerLogger,
    shutdownGracefully: () =>
      shutdownGracefully({
        loop,
        logger: workerLogger,
        hasActiveJob: () => jobExecutionRegistry.hasActiveJob(),
        abortActiveJob: (reason) => jobExecutionRegistry.abortActiveJob(reason),
        getActiveJobCyclePromise: () => activeJobCyclePromise
      }),
    exit: process.exit.bind(process),
    on: (event, listener) => process.once(event, listener)
  });

  // P3/P4 (2026-09-04): before this fresh process starts claiming any new
  // work, reconcile any job the API still shows as non-terminal for this
  // workerId - left behind by a worker process that crashed/was killed
  // mid-job without ever reporting its own outcome. See
  // reconcile-abandoned-jobs.ts's own doc comment on the exact boundary of
  // what this proves.
  await reconcileAbandonedJobs({
    listActiveJobs: () => apiClient.listActiveJobs(credentials.workerId, credentials.workerToken),
    reportJobStatus: (jobId, body) => apiClient.reportJobStatus(credentials.workerId, credentials.workerToken, jobId, body),
    logger: workerLogger
  });

  loop.start();
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`Worker configuration error: ${error.message}`);
  } else {
    console.error("Worker failed to start", error);
  }
  process.exit(1);
});
