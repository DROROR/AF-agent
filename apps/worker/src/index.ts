import { existsSync } from "node:fs";
import pino from "pino";
import { resolveWorkerCredentials } from "./bootstrap.js";
import { CURRENT_WORKER_CAPABILITIES } from "./domain/operation-allowlist.js";
import type { LatestHealth } from "./domain/job-dispatcher.js";
import { executeJobWithWatchdog } from "./domain/job-watchdog.js";
import { loadWorkerEnv } from "./env.js";
import { ConfigError } from "./errors/worker-error.js";
import { buildHealthSnapshot } from "./health/health-snapshot.js";
import { AeMcpRoundTripAdapter } from "./health/ae-mcp-round-trip-adapter.js";
import { AeBridgeReconnector } from "./health/reconnect-ae-bridge.js";
import { AeLauncher } from "./health/ensure-ae-running.js";
import { launchAe } from "./health/launch-ae.js";
import { HeroicSwanMcpClient } from "./inspection/heroic-swan-mcp-client.js";
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
import { withDeadline } from "./infrastructure/with-deadline.js";
import type { RunDiagnosticDeps } from "./diagnostics/run-diagnostic.js";
import type { ActiveWorkSnapshot, RestartWorkerSafeDeps } from "./diagnostics/restart-worker-safe.js";
import {
  describeJobArtifactsUnder,
  describeLogFile,
  readDiskSpaceFor,
  readTextTailFromWorkRoot
} from "./diagnostics/collect-diagnostics.js";
import { WORKER_LOG_RELATIVE_PATH, PREVIOUS_WORKER_LOG_RELATIVE_PATH } from "./diagnostics/run-diagnostic.js";
import { listDyoProcessesViaCim } from "./diagnostics/list-dyo-processes.js";
import { redactSecrets } from "./diagnostics/redact.js";
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


/**
 * Compact, redacted, bounded summary of an MCP tool's response content, for
 * logging. Never the raw object: tool content is arbitrary upstream data, it
 * can be large, and it goes straight into worker.log.
 */
function summarizeToolContent(content: unknown): string {
  let text: string;
  try {
    text = typeof content === "string" ? content : JSON.stringify(content);
  } catch {
    return "response could not be serialized";
  }
  if (!text) {
    return "empty response";
  }
  const redacted = redactSecrets(text);
  return redacted.length > 600 ? `${redacted.slice(0, 600)}... (truncated)` : redacted;
}

/** Hard ceiling on one claim attempt - see its call site's own rationale. */
const CLAIM_DEADLINE_MS = 30_000;

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
  // Real 2026-09-12 incident fix: the previous adapter judged the bridge by
  // the exit code of `node <ae-mcp>/dist/index.js health` under a hard 8s
  // ceiling, and reported a genuinely healthy bridge as UNKNOWN whenever
  // upstream's own "ensure" work ran long - permanently blocking every
  // dispatch whose precondition is MCP ONLINE. This performs the same real
  // MCP round trip a job does. See ae-mcp-round-trip-adapter.ts.
  // Bounded self-heal for the one AE/MCP failure the worker can safely fix
  // itself in place (2026-09-12 incident): After Effects running, but its
  // Startup bootstrap never registered an instance, so the bridge answers
  // `connected: false` forever and ae-mcp's own ensure step declines to act.
  // ae_reconnect re-registers a RUNNING AE without starting, stopping or
  // touching anything - see reconnect-ae-bridge.ts for the full safety
  // argument and the bounded policy.
  const bridgeReconnector = new AeBridgeReconnector({
    callReconnect: async () => {
      if (!env.aeMcpPath) {
        return { ok: false, detail: "AE_MCP_PATH is not configured" };
      }
      const client = new HeroicSwanMcpClient({ aeMcpPath: env.aeMcpPath, timeoutMs: 30_000 });
      try {
        await client.connect();
        const call = await client.callTool("ae_reconnect");
        if (!call.ok) {
          return { ok: false, detail: `${call.error.code}: ${call.error.message}` };
        }
        // REAL 2026-09-12 GAP: this used to report only "ae_reconnect
        // returned a response" and throw the body away. On the machine this
        // was written for, the call succeeded and the bridge STILL did not
        // register - and the reason was in the body nobody kept. A tool
        // answering is not the same as a tool working, and the difference is
        // exactly what an incident needs. Bounded and redacted, because this
        // lands in worker.log.
        return { ok: true, detail: summarizeToolContent(call.content) };
      } finally {
        await client.close().catch(() => {
          // Never let cleanup failure change the recovery verdict.
        });
      }
    },
    now: () => Date.now(),
    logger: workerLogger
  });

  const mcpAdapter = new AeMcpRoundTripAdapter({
    aeMcpPath: env.aeMcpPath,
    createClient: (aeMcpPath, timeoutMs) => new HeroicSwanMcpClient({ aeMcpPath, timeoutMs }),
    bridgeReconnector
  });

  // Real 2026-09-12 release blocker: after a Windows restart the client was
  // being asked to open After Effects by hand before any job could run. The
  // worker already starts itself at logon (its Scheduled Task is registered
  // -AtLogOn with RestartCount 999); this closes the remaining manual step.
  // Bounded by construction - see ensure-ae-running.ts.
  const aeLauncher = new AeLauncher(
    { aePath: env.aePath },
    { processLister, launchAe, now: () => Date.now() }
  );

  // Real, production INSPECT_TEMPLATE implementation - see
  // docs/TEMPLATE-INSPECTOR.md. Always safe to construct even with no
  // AE_MCP_PATH configured: inspect() reports a typed unavailable capture
  // rather than crashing or fabricating a result.
  const templateInspector = new HeroicSwanTemplateInspector({
    aeMcpPath: env.aeMcpPath,
    logger: workerLogger,
    jobExecutionRegistry,
    workRoot: env.workRoot
  });

  // Remote Windows diagnostics (2026-09-12) - see diagnostics/diagnostics.ts.
  // Every filesystem read below is resolved from workRoot by the WORKER: the
  // request schema carries no path, so there is nothing a caller could aim
  // anywhere. `mutating` deliberately lists only the operations that write to
  // an AE project or render, because those are the only ones a restart can
  // genuinely damage.
  const diagnosticsDeps: RunDiagnosticDeps = {
    workerId: credentials.workerId,
    now: () => new Date(),
    readTextTail: (relativePath, maxLines) => readTextTailFromWorkRoot(workRoot, relativePath, maxLines),
    listDyoProcesses: () => listDyoProcessesViaCim(),
    readDiskSpace: () => readDiskSpaceFor([workRoot, ...(env.aeMcpPath ? [env.aeMcpPath] : [])]),
    probeAeMcpHealth: async () => {
      const health = await mcpAdapter.checkHealth();
      return {
        mcpStatus: health.mcpStatus,
        mcpProbeDetail: health.mcpProbeDetail,
        mcpConfiguredPath: health.mcpConfiguredPath
      };
    },
    describeActiveJob: async () => {
      const active = jobExecutionRegistry.getActiveJob();
      return {
        activeJob: active ? { jobId: active.jobId, operation: active.operation } : null,
        workerLog: describeLogFile(workRoot, WORKER_LOG_RELATIVE_PATH),
        previousWorkerLog: describeLogFile(workRoot, PREVIOUS_WORKER_LOG_RELATIVE_PATH),
        lastConfirmedHealth: latestHealth
      };
    },
    describeJobArtifacts: (jobId) => describeJobArtifactsUnder(workRoot, jobId)
  };

  const MUTATING_OPERATIONS = new Set(["EXECUTE_FRAME", "RENDER", "CREATE_PREVIEW"]);
  const restartWorkerSafeDeps: RestartWorkerSafeDeps = {
    workerId: credentials.workerId,
    now: () => new Date(),
    describeActiveWork: (): ActiveWorkSnapshot => {
      const active = jobExecutionRegistry.getActiveJob();
      if (!active) {
        return { jobId: null, operation: null, mutating: false, checkpointed: false };
      }
      return {
        jobId: active.jobId,
        operation: active.operation,
        mutating: MUTATING_OPERATIONS.has(active.operation),
        // Conservative by design: this worker does not track checkpoint
        // progress in the registry, so a mutating job is always treated as
        // uncheckpointed and the restart is REFUSED. Refusing a restart that
        // would have been safe costs a wait; allowing one that was not costs
        // a corrupted working copy or an hour of render.
        checkpointed: false
      };
    },
    scheduleExit: (delayMs, exitCode) => {
      const timer = setTimeout(() => {
        workerLogger.info({ exitCode }, "exiting for an operator-requested safe restart - the supervisor will start one replacement");
        process.exit(exitCode);
      }, delayMs);
      timer.unref();
    },
    logger: workerLogger
  };

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
  // workerLogger (the same real, worker.log-piped logger every other
  // component here already uses) is threaded through so a failure here is
  // never silent again (live QA regression, 2026-09-07).
  const sceneEvidencePreviewUploader = new HeroicSwanSceneEvidencePreviewUploader(apiClient, credentials.workerId, credentials.workerToken, workerLogger);
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
      // Bounded for the same reason the heartbeat tick is (2026-09-12): a
      // claim that never settles leaves activeJobCyclePromise non-null
      // forever, so every later heartbeat logs "job cycle already in
      // progress" and this worker never claims another job for the life of
      // the process - online, healthy-looking, and permanently idle. The
      // ceiling is generous next to a claim that normally answers in well
      // under a second.
      claimNextJob: () =>
        withDeadline("claim next job", CLAIM_DEADLINE_MS, () =>
          apiClient.claimNextJob(credentials.workerId, credentials.workerToken)
        ),
      reportJobStatus: (jobId, body) =>
        apiClient.reportJobStatus(credentials.workerId, credentials.workerToken, jobId, body),
      executeJob: (job) =>
        executeJobWithWatchdog(
          {
            diagnostics: diagnosticsDeps,
            restartWorkerSafe: restartWorkerSafeDeps,
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
            now: () => new Date(),
            logger: workerLogger
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
      // Self-recovery (2026-09-12): AE being down is the one cause of a
      // stalled machine this worker can safely fix itself. Every outcome is
      // bounded and logged - a "blocked" outcome means the bounded budget is
      // spent and a human genuinely needs to look, which is reported rather
      // than retried forever.
      if (health.aeStatus === "OFFLINE") {
        const ensured = await aeLauncher.ensureRunning();
        if (ensured.action === "blocked" || ensured.action === "unavailable") {
          workerLogger.warn({ ensureAe: ensured }, "After Effects is not running and this worker could not start it");
        } else if (ensured.action === "launched") {
          workerLogger.info({ ensureAe: ensured }, "After Effects was not running - started it automatically");
        }
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
  // REAL 2026-09-12 INCIDENT: this used to be AWAITED here, before the loop
  // started. On a machine where /jobs/active was briefly unreachable the
  // worker logged "worker starting" and then went silent - no first
  // heartbeat, no registration, no polling - for as long as the bounded
  // retries took. Worker availability must never depend on recovery
  // succeeding: the loop starts FIRST, and reconciliation runs independently
  // behind it. Its failure is logged loudly and changes nothing else.
  loop.start();

  void reconcileAbandonedJobs({
    listActiveJobs: () => apiClient.listActiveJobs(credentials.workerId, credentials.workerToken),
    reportJobStatus: (jobId, body) => apiClient.reportJobStatus(credentials.workerId, credentials.workerToken, jobId, body),
    logger: workerLogger
  }).catch((error: unknown) => {
    workerLogger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "abandoned-job reconciliation did not complete - this worker is still online and claiming work normally"
    );
  });
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`Worker configuration error: ${error.message}`);
  } else {
    console.error("Worker failed to start", error);
  }
  process.exit(1);
});
