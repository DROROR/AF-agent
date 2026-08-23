import pino from "pino";
import { resolveWorkerCredentials } from "./bootstrap.js";
import { CURRENT_WORKER_CAPABILITIES } from "./domain/operation-allowlist.js";
import { loadWorkerEnv } from "./env.js";
import { ConfigError } from "./errors/worker-error.js";
import { buildHealthSnapshot } from "./health/health-snapshot.js";
import { NotIntegratedMcpAdapter } from "./health/mcp-adapter.js";
import { McpInstanceFileAdapter } from "./health/mcp-instance-file-adapter.js";
import { ApiClient } from "./infrastructure/api-client.js";
import { CredentialStore } from "./infrastructure/credential-store.js";
import { createProcessLister } from "./infrastructure/process-lister.js";
import { HeartbeatLoop, type HeartbeatLoopEvent } from "./runtime/heartbeat-loop.js";
import { shutdownGracefully } from "./runtime/shutdown.js";
import { buildHeartbeatPayload } from "./application/build-heartbeat-payload.js";
import { ensureWorkRoot, resolveWorkRoot } from "./workspace/work-root.js";

/** Not exposed via env - Phase 2 fixes a conservative, bounded retry policy rather than making it operator-tunable before there's a reason to. */
const HEARTBEAT_BACKOFF_POLICY = { baseMs: 2_000, maxMs: 60_000 };

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
  // McpInstanceFileAdapter is only selected once AE_MCP_INSTANCE_FILE_PATH
  // is actually configured, so an unconfigured worker keeps the exact
  // NotIntegratedMcpAdapter behavior it has always had.
  const mcpAdapter = env.aeMcpInstanceFilePath
    ? new McpInstanceFileAdapter({ instanceFilePath: env.aeMcpInstanceFilePath })
    : new NotIntegratedMcpAdapter(env.aeMcpPath);

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
    onEvent: (event) => logHeartbeatEvent(workerLogger, event)
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
