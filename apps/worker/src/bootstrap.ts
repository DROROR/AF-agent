import { ConfigError } from "./errors/worker-error.js";
import type { WorkerEnv } from "./env.js";
import { CURRENT_WORKER_CAPABILITIES } from "./domain/operation-allowlist.js";
import type { ApiClient } from "./infrastructure/api-client.js";
import type { CredentialStore, WorkerCredentials } from "./infrastructure/credential-store.js";

const PHASE_2_MAX_CONCURRENCY = 1;

export interface BootstrapLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Resolves the credentials this run will authenticate with, in priority
 * order: pre-provisioned WORKER_ID/WORKER_TOKEN env vars, then a
 * previously-persisted pairing, then fresh registration using
 * WORKER_REGISTRATION_SECRET (one-time only - see CLAUDE.md Phase 2 task 3).
 * Never logs the token itself, only the resolved workerId.
 */
export async function resolveWorkerCredentials(
  env: WorkerEnv,
  credentialStore: CredentialStore,
  apiClient: ApiClient,
  logger: BootstrapLogger
): Promise<WorkerCredentials> {
  if (env.workerId && env.workerToken) {
    logger.info("Using pre-provisioned worker credentials from the environment", {
      workerId: env.workerId
    });
    return { workerId: env.workerId, workerToken: env.workerToken };
  }

  const stored = credentialStore.load();
  if (stored) {
    logger.info("Using persisted worker credentials from a prior pairing", {
      workerId: stored.workerId
    });
    return stored;
  }

  if (!env.workerRegistrationSecret) {
    throw new ConfigError(
      "No worker credentials available: set WORKER_ID and WORKER_TOKEN, or set " +
        "WORKER_REGISTRATION_SECRET for first-time pairing."
    );
  }

  logger.info("No credentials found locally - registering with the API");
  const response = await apiClient.registerWorker(env.workerRegistrationSecret, {
    name: env.workerName,
    maxConcurrency: PHASE_2_MAX_CONCURRENCY,
    capabilities: [...CURRENT_WORKER_CAPABILITIES]
  });
  const credentials: WorkerCredentials = {
    workerId: response.workerId,
    workerToken: response.workerToken
  };
  credentialStore.save(credentials);
  logger.info("Registered with the API and persisted issued credentials", {
    workerId: credentials.workerId
  });
  return credentials;
}
