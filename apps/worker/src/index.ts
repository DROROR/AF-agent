import pino from "pino";
import { resolveWorkerCredentials } from "./bootstrap.js";
import { CURRENT_WORKER_CAPABILITIES } from "./domain/operation-allowlist.js";
import { executeJob } from "./domain/job-dispatcher.js";
import { loadWorkerEnv } from "./env.js";
import { ConfigError } from "./errors/worker-error.js";
import { buildHealthSnapshot } from "./health/health-snapshot.js";
import { HeroicSwanMcpAdapter } from "./health/heroic-swan-mcp-adapter.js";
import { NotAvailableTemplateInspector } from "./inspection/template-inspector.js";
import { ApiClient } from "./infrastructure/api-client.js";
import { CredentialStore } from "./infrastructure/credential-store.js";
import { createProcessLister } from "./infrastructure/process-lister.js";
import { HeartbeatLoop, type HeartbeatLoopEvent } from "./runtime/heartbeat-loop.js";
import { runJobCycle, type JobCycleEvent } from "./runtime/job-cycle.js";
import { shutdownGracefully } from "./runtime/shutdown.js";
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
        { status: event.worker.status, aeStatus: event.worker.aeStatus, mcpStatus: event.worker.mcpStatus },
        "heartbeat succeeded"
      );
      return;
    case "heartbeat_failed":
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

  const env = loadWorkerEnv();
  const workRoot = resolveWorkRoot(env.workRoot);
  ensureWorkRoot(workRoot);

  const apiClient = new ApiClient({ apiUrl: env.apiUrl });
  const credentialStore = new CredentialStore(workRoot);
  const credentials = await resolveWorkerCredentials(env, credentialStore, apiClient, logger);

  const workerLogger = logger.child({ workerId: credentials.workerId, workerName: env.workerName });
  workerLogger.info(
    { workRoot, capabilities: CURRENT_WORKER_CAPABILITIES },
    "worker starting"
  );

  const processLister = createProcessLister();
  // Primary MCP health source: the real HeroicSwan/after-effects-mcp CLI's
  // documented `health` subcommand and exit-code contract (confirmed
  // 2026-08-24 directly from the upstream repository) - not undocumented
  // instance.json file internals. Always safe to construct even with no
  // AE_MCP_PATH configured (or on a Linux dev/test machine): it reports
  // UNKNOWN rather than crashing or fabricating a status.
  const mcpAdapter = new HeroicSwanMcpAdapter({ aeMcpPath: env.aeMcpPath });

  // No real ae-mcp bridge protocol is confirmed yet - see
  // docs/TEMPLATE-INSPECTOR.md. Wiring this in now (rather than leaving
  // INSPECT_TEMPLATE entirely unreachable) means a dispatched job fails
  // safely with a typed NOT_AVAILABLE result instead of never being
  // attempted at all.
  const templateInspector = new NotAvailableTemplateInspector();

  // One bounded claim/execute/report attempt per successful heartbeat -
  // never a separate tight polling loop, so job attempts are naturally
  // paced by HEARTBEAT_INTERVAL_MS with no blind retries.
  const triggerJobCycle = (): void => {
    void runJobCycle({
      claimNextJob: () => apiClient.claimNextJob(credentials.workerId, credentials.workerToken),
      reportJobStatus: (jobId, body) =>
        apiClient.reportJobStatus(credentials.workerId, credentials.workerToken, jobId, body),
      executeJob: (job) => executeJob({ templateInspector }, job),
      onEvent: (event) => logJobCycleEvent(workerLogger, event)
    });
  };

  const loop = new HeartbeatLoop({
    buildPayload: async () => {
      const health = await buildHealthSnapshot(
        { aePath: env.aePath, aerenderPath: env.aerenderPath },
        { processLister, mcpAdapter }
      );
      return buildHeartbeatPayload(health);
    },
    sendHeartbeat: (payload) =>
      apiClient.sendHeartbeat(credentials.workerId, credentials.workerToken, payload),
    intervalMs: env.heartbeatIntervalMs,
    backoff: HEARTBEAT_BACKOFF_POLICY,
    onEvent: (event) => {
      logHeartbeatEvent(workerLogger, event);
      if (event.type === "heartbeat_succeeded") {
        triggerJobCycle();
      }
    }
  });

  let shuttingDown = false;
  const handleSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    workerLogger.info({ signal }, "received shutdown signal");
    void shutdownGracefully(loop, workerLogger).then(
      () => process.exit(0),
      (error: unknown) => {
        workerLogger.error({ error }, "error during shutdown");
        process.exit(1);
      }
    );
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

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
